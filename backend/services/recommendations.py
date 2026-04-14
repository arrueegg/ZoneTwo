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


async def generate_weekly_ai_summary(
    goal: str,
    target_race: str,
    week_data: dict[str, Any],
) -> str:
    """
    Weekly AI coaching summary powered by Llama 3 via Groq (free tier).
    Call this once per athlete per week.
    """
    prompt = f"""Athlete profile: {goal} runner, training for {target_race}.

Last 7 days summary:
- Total distance: {week_data['distance_km']:.1f} km
- Total time: {week_data['duration_hours']:.1f} hours
- Zone distribution: {week_data['zone_distribution']}
- ATL (fatigue): {week_data['atl']:.1f}, CTL (fitness): {week_data['ctl']:.1f}, TSB (form): {week_data['tsb']:.1f}
- Average HRV: {week_data['hrv_trend']}
- Average sleep: {week_data['avg_sleep_score']}

Provide:
1. A brief summary of the week (2-3 sentences)
2. One specific training recommendation for next week
3. One recovery insight based on HRV/sleep data

Be concise, actionable, and evidence-based. No generic advice."""

    def _call() -> str:
        client = groq_lib.Groq(api_key=settings.groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=400,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a data-driven endurance coach. "
                        "Use the training metrics provided to give specific, grounded feedback. "
                        "Never give advice that contradicts the numbers."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )
        return response.choices[0].message.content or ""

    return await asyncio.to_thread(_call)
