from typing import Any

import anthropic

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


async def generate_weekly_ai_summary(
    goal: str,
    target_race: str,
    week_data: dict[str, Any],
) -> str:
    """
    Weekly AI coaching summary powered by Claude.
    Call this once per athlete per week — not on every sync.
    """
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    prompt = f"""Athlete profile: {goal} runner, training for {target_race}.

Last 7 days summary:
- Total distance: {week_data['distance_km']:.1f} km
- Total time: {week_data['duration_hours']:.1f} hours
- Zone distribution: {week_data['zone_distribution']}
- ATL (fatigue): {week_data['atl']:.1f}, CTL (fitness): {week_data['ctl']:.1f}, TSB (form): {week_data['tsb']:.1f}
- Average HRV trend: {week_data['hrv_trend']}
- Sleep score average: {week_data['avg_sleep_score']}

Based on this data, provide:
1. A brief summary of the week (2-3 sentences)
2. One specific training recommendation for next week
3. One recovery insight based on HRV/sleep data

Keep it concise, actionable, and evidence-based. No generic advice."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        system=(
            "You are a data-driven endurance coach. "
            "Use the training metrics provided to give specific, grounded feedback. "
            "Never give advice that contradicts the numbers."
        ),
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text  # type: ignore[union-attr]
