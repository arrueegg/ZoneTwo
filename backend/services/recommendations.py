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


def _extract_json(text: str) -> dict[str, str]:
    """
    Pull the first JSON object out of the model response.
    Falls back to wrapping the whole text if no JSON block is found.
    """
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    # Last resort: treat the whole response as the week summary
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
    prompt = f"""Athlete profile: goal "{goal}", training for "{target_race}".

Last 7 days:
- Distance: {week_data['distance_km']:.1f} km, Time: {week_data['duration_hours']:.1f} h
- Zone distribution: {week_data['zone_distribution']}
- ATL: {week_data['atl']:.1f}, CTL: {week_data['ctl']:.1f}, TSB: {week_data['tsb']:.1f}
- HRV avg: {week_data['hrv_trend']}, Sleep avg: {week_data['avg_sleep_score']}

Reply with ONLY valid JSON — no explanation, no markdown, no code fences. Use exactly this structure:
{{
  "week_summary": "2-3 sentence summary of what the data shows about this week",
  "training_recommendation": "one specific, actionable recommendation for next week based on the numbers",
  "recovery_insight": "one insight about recovery based on HRV and sleep data"
}}"""

    def _call() -> dict[str, str]:
        client = groq_lib.Groq(api_key=settings.groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=500,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a data-driven endurance coach. "
                        "Respond only with the JSON structure requested. "
                        "Base every statement on the numbers provided. "
                        "Never give generic advice."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )
        raw = response.choices[0].message.content or ""
        return _extract_json(raw)

    return await asyncio.to_thread(_call)
