from typing import Any
import asyncio
import json
import re

import groq as groq_lib

from config import settings


def generate_rule_based_insights(
    metrics_today: dict[str, float],
    metrics_7d_ago: dict[str, float],
) -> list[dict[str, Any]]:
    """
    Fast, always-on rule-based coaching insights.
    Runs every time metrics are recalculated.
    """
    insights: list[dict[str, Any]] = []
    tsb = metrics_today["tsb"]
    atl = metrics_today["atl"]
    atl_7d = metrics_7d_ago["atl"]

    if tsb < -25:
        insights.append(
            {
                "type": "warning",
                "title": "High fatigue detected",
                "body": (
                    f"Your TSB is {tsb:.0f}. Consider an easy day or rest — "
                    "recovery is where adaptation happens."
                ),
                "priority": "high",
            }
        )

    # Load spike: ATL increased more than 15% week-over-week
    if atl_7d > 0 and atl > atl_7d * 1.15:
        insights.append(
            {
                "type": "warning",
                "title": "Rapid load increase",
                "body": (
                    "Your training load jumped more than 15% this week. "
                    "Injury risk rises above 10% weekly increases."
                ),
                "priority": "medium",
            }
        )

    if -5 < tsb < 15:
        insights.append(
            {
                "type": "positive",
                "title": "Good form window",
                "body": (
                    "Your TSB suggests you're well-rested and adapted. "
                    "A good time for a quality workout or race."
                ),
                "priority": "low",
            }
        )

    return insights


_KEYS = ("week_summary", "training_recommendation", "recovery_insight")


def _training_load_context(tsb: float, atl: float, ctl: float) -> str:
    if tsb <= -25:
        return "fatigue is high; recommend backing off unless there is an important race"
    if tsb <= -10:
        return "training stress is meaningful; quality is possible but should be selective"
    if tsb < 10:
        return "load and freshness are balanced; this is a good maintenance or controlled build window"
    if tsb <= 25:
        return "freshness is good; this can support a quality session if recovery signals agree"
    if ctl > 0 and atl < ctl * 0.75:
        return "freshness is high but recent load may be low; rebuild rhythm before adding intensity"
    return "freshness is high; avoid interpreting that as fitness unless training volume is consistent"


def _sleep_context(avg_sleep: str) -> str:
    match = re.match(r"([0-9.]+)h", str(avg_sleep))
    if not match:
        return "sleep data is missing; avoid strong recovery claims"
    hours = float(match.group(1))
    if hours < 6:
        return "sleep is low; reduce intensity or volume until this improves"
    if hours < 7:
        return "sleep is acceptable but not robust; keep hard sessions controlled"
    return "sleep supports normal training progression"


def _volume_context(distance_km: float, duration_hours: float) -> str:
    if distance_km <= 0 and duration_hours <= 0:
        return "no recent training was recorded; restart with short easy runs"
    if distance_km < 15:
        return "recent run volume is modest; prioritize consistency before aggressive workouts"
    if distance_km < 35:
        return "recent run volume supports a steady build with one controlled quality day"
    return "recent run volume is substantial; protect recovery and avoid stacking hard sessions"


def _extract_json(text: str) -> dict[str, str]:
    """
    Pull a structured summary dict from the model response.

    Priority:
    1. Valid JSON object with quoted values
    2. JSON-like object where values are unquoted bullet lines (model omits quotes)
    3. Markdown bold-header format: **Label:** content
    4. Numbered list: 1. / 2. / 3.
    5. Fallback: whole text as week_summary
    """
    # 1. Try strict JSON — grab the outermost {...} block
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, dict) and "week_summary" in parsed:
                return {k: str(v).strip() for k, v in parsed.items()}
        except json.JSONDecodeError:
            pass

        # 2. JSON-like with unquoted values: "key":\n•line\n•line
        raw_block = match.group()
        result: dict[str, str] = {}
        for key in _KEYS:
            # Match "key": followed by anything up to the next "key": or end of block
            pattern = rf'"{key}"\s*:\s*(.*?)(?="(?:{"|".join(_KEYS)})"|\}})'
            m = re.search(pattern, raw_block, re.DOTALL)
            if m:
                result[key] = m.group(1).strip().strip('",').strip()
        if len(result) >= 2:
            return {k: result.get(k, "") for k in _KEYS}

    # 3. Markdown bold-header sections: **Some label:** text
    bold_sections = re.findall(r"\*\*([^*]+?)\*\*[:\s]+(.*?)(?=\*\*|$)", text, re.DOTALL)
    if len(bold_sections) >= 2:
        parts = [s[1].strip().rstrip("*").strip() for s in bold_sections]
        return {
            "week_summary": parts[0] if len(parts) > 0 else "",
            "training_recommendation": parts[1] if len(parts) > 1 else "",
            "recovery_insight": parts[2] if len(parts) > 2 else "",
        }

    # 4. Numbered list
    numbered = re.findall(r"(?:^|\n)\d+\.\s+(.+?)(?=\n\d+\.|\Z)", text, re.DOTALL)
    if len(numbered) >= 2:
        return {
            "week_summary": numbered[0].strip(),
            "training_recommendation": numbered[1].strip(),
            "recovery_insight": numbered[2].strip() if len(numbered) > 2 else "",
        }

    # 5. Last resort
    return {"week_summary": text.strip(), "training_recommendation": "", "recovery_insight": ""}


async def generate_weekly_ai_summary(
    goal: str,
    target_race: str,
    week_data: dict[str, Any],
) -> dict[str, str]:
    """
    Weekly AI coaching summary powered by Llama 3 via Groq (free tier).
    Returns a dict with keys: week_summary, training_recommendation, recovery_insight.
    Call this once per athlete per week.
    """
    load_context = _training_load_context(float(week_data["tsb"]), float(week_data["atl"]), float(week_data["ctl"]))
    sleep_context = _sleep_context(str(week_data["avg_sleep_score"]))
    volume_context = _volume_context(float(week_data["distance_km"]), float(week_data["duration_hours"]))

    prompt = f"""Athlete goal: "{goal}", target race: "{target_race}".

Data (last 7 days):
distance={week_data['distance_km']:.1f}km, time={week_data['duration_hours']:.1f}h, zones={week_data['zone_distribution']}
ATL={week_data['atl']:.1f}, CTL={week_data['ctl']:.1f}, TSB={week_data['tsb']:.1f}
HRV={week_data['hrv_trend']}, sleep={week_data['avg_sleep_score']}

Coaching context:
- Load/form: {load_context}
- Sleep/recovery: {sleep_context}
- Volume: {volume_context}

Output ONLY this JSON object, no other text:
{{"week_summary":"• bullet 1\\n• bullet 2\\n• bullet 3","training_recommendation":"• bullet 1\\n• bullet 2","recovery_insight":"• bullet 1\\n• bullet 2"}}

Your job is NOT to repeat the data. Interpret it like a coach.

Rules:
- Address the athlete directly as "you"
- Each field is 2-3 short bullet points starting with "• "
- Every bullet must include at least one judgement, implication, or concrete action
- Use numbers only when they support a coaching decision; do not list metrics just to list them
- Do not write bullets that merely restate distance, time, CTL, ATL, TSB, HRV, sleep, or zone distribution
- Make at least one clear recommendation for what to do next week
- Use plain coaching language: "good time to push", "hold steady", "back off", "add one quality day", "keep this easy", etc.
- No markdown bold and no headers"""

    def _call() -> dict[str, str]:
        client = groq_lib.Groq(api_key=settings.groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=500,
            temperature=0.3,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a direct, data-driven endurance coach talking to your athlete. "
                        "Your value is interpretation and judgement, not metric narration. "
                        "Output ONLY raw JSON — no markdown, no explanation, no code fences. "
                        "Use bullet points starting with • and always address the athlete as 'you'."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )
        raw = response.choices[0].message.content or ""
        return _extract_json(raw)

    return await asyncio.to_thread(_call)
