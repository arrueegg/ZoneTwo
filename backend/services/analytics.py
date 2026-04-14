"""
Analytics engine: readiness score, anomaly detection, weekly summaries, correlations.
All functions operate on lists of DailyMetrics ORM objects or dicts — no DB calls here.
"""

import math
from datetime import date, timedelta
from typing import Any


# ── Readiness Score ────────────────────────────────────────────────────────────

def compute_readiness_score(
    today: dict[str, Any],
    baseline: dict[str, float],  # 30-day medians for each metric
) -> float:
    """
    Composite readiness score (0–100) from wellness signals.

    Weights:
      HRV vs baseline          35 %
      Resting HR vs baseline   25 %
      Sleep hours              20 %
      Body battery at wake     15 %
      Stress (inverted)         5 %
    """
    scores: list[tuple[float, float]] = []  # (score, weight)

    # HRV: higher than baseline = better
    hrv = today.get("hrv_rmssd")
    hrv_baseline = baseline.get("hrv_rmssd")
    if hrv and hrv_baseline:
        ratio = hrv / hrv_baseline
        s = _clamp(50 + (ratio - 1) * 150, 0, 100)
        scores.append((s, 0.35))

    # Resting HR: lower than baseline = better
    rhr = today.get("resting_hr")
    rhr_baseline = baseline.get("resting_hr")
    if rhr and rhr_baseline:
        ratio = rhr_baseline / rhr  # inverted
        s = _clamp(50 + (ratio - 1) * 200, 0, 100)
        scores.append((s, 0.25))

    # Sleep: 8 h target, diminishing returns above, penalty below
    sleep = today.get("sleep_hours")
    if sleep is not None:
        if sleep >= 8:
            s = min(100.0, 75 + (sleep - 8) * 6.25)
        else:
            s = max(0.0, (sleep / 8) * 75)
        scores.append((s, 0.20))

    # Body battery at wake: already 0–100
    bb_wake = today.get("body_battery_wake")
    if bb_wake is not None:
        scores.append((float(bb_wake), 0.15))

    # Stress: lower = better
    stress = today.get("stress_avg")
    if stress is not None:
        s = _clamp(100 - stress, 0, 100)
        scores.append((s, 0.05))

    if not scores:
        return 50.0  # neutral default when no data

    total_weight = sum(w for _, w in scores)
    weighted = sum(s * w for s, w in scores)
    return round(weighted / total_weight, 1)


def compute_baseline(history: list[dict[str, Any]], days: int = 30) -> dict[str, float]:
    """Compute median values for each wellness metric over the last N days."""
    metrics = ["hrv_rmssd", "resting_hr", "sleep_hours", "body_battery_wake",
               "body_battery_high", "stress_avg", "spo2_avg", "steps"]
    baseline: dict[str, float] = {}
    for key in metrics:
        vals = [r[key] for r in history if r.get(key) is not None]
        if vals:
            baseline[key] = _median(vals)
    return baseline


# ── Anomaly Detection ──────────────────────────────────────────────────────────

ANOMALY_CONFIG = {
    "hrv_rmssd":        {"label": "HRV",            "direction": "low",  "threshold": 1.5},
    "resting_hr":       {"label": "Resting HR",     "direction": "high", "threshold": 1.5},
    "sleep_hours":      {"label": "Sleep",          "direction": "low",  "threshold": 1.5},
    "body_battery_wake":{"label": "Body battery",   "direction": "low",  "threshold": 1.5},
    "stress_avg":       {"label": "Stress",         "direction": "high", "threshold": 1.5},
    "spo2_avg":         {"label": "SpO₂",           "direction": "low",  "threshold": 2.0},
}


def detect_anomalies(
    today: dict[str, Any],
    history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Return a list of anomaly dicts for any metric that is significantly
    off today relative to the rolling mean/std of recent history.
    """
    anomalies = []

    for key, cfg in ANOMALY_CONFIG.items():
        value = today.get(key)
        if value is None:
            continue

        vals = [r[key] for r in history if r.get(key) is not None]
        if len(vals) < 7:
            continue

        mean = sum(vals) / len(vals)
        std = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))
        if std == 0:
            continue

        z = (value - mean) / std

        is_anomaly = (
            (cfg["direction"] == "low"  and z < -cfg["threshold"]) or
            (cfg["direction"] == "high" and z >  cfg["threshold"])
        )

        if is_anomaly:
            direction_word = "below" if z < 0 else "above"
            anomalies.append({
                "metric": key,
                "label": cfg["label"],
                "value": value,
                "mean": round(mean, 1),
                "z_score": round(z, 2),
                "direction": direction_word,
                "message": _anomaly_message(cfg["label"], value, mean, z, key),
            })

    return anomalies


def _anomaly_message(label: str, value: float, mean: float, z: float, key: str) -> str:
    diff = abs(value - mean)
    direction = "below" if z < 0 else "above"

    if key == "hrv_rmssd":
        return f"HRV is {value:.0f} ms, {diff:.0f} ms {direction} your average ({mean:.0f} ms). Recovery may be compromised."
    if key == "resting_hr":
        return f"Resting HR is {value:.0f} bpm, {diff:.0f} bpm {direction} your average ({mean:.0f} bpm). Could indicate stress, illness, or under-recovery."
    if key == "sleep_hours":
        return f"Sleep was {value:.1f} h, {diff:.1f} h {direction} your average ({mean:.1f} h)."
    if key == "body_battery_wake":
        return f"Body battery at wake was {value:.0f}, {diff:.0f} points {direction} your average ({mean:.0f})."
    if key == "stress_avg":
        return f"Average stress was {value:.0f}, {diff:.0f} points {direction} your norm ({mean:.0f})."
    if key == "spo2_avg":
        return f"SpO₂ was {value:.1f}%, {diff:.1f}% {direction} your average ({mean:.1f}%)."
    return f"{label} is {direction} your average."


# ── Weekly Summary ─────────────────────────────────────────────────────────────

def compute_weekly_summary(
    history: list[dict[str, Any]],
    weeks: int = 8,
) -> list[dict[str, Any]]:
    """
    Return per-week averages for the last N weeks with trend vs prior week.
    history: list of daily dicts sorted ascending by date.
    """
    if not history:
        return []

    today = date.fromisoformat(history[-1]["date"])
    summaries = []

    for w in range(weeks - 1, -1, -1):
        week_end = today - timedelta(days=w * 7)
        week_start = week_end - timedelta(days=6)
        week_days = [
            r for r in history
            if week_start <= date.fromisoformat(r["date"]) <= week_end
        ]
        if not week_days:
            continue

        prev_end = week_start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=6)
        prev_days = [
            r for r in history
            if prev_start <= date.fromisoformat(r["date"]) <= prev_end
        ]

        metrics = ["hrv_rmssd", "resting_hr", "sleep_hours", "readiness_score",
                   "body_battery_wake", "stress_avg", "steps"]

        week_avgs: dict[str, float | None] = {}
        prev_avgs: dict[str, float | None] = {}
        trends: dict[str, str] = {}

        for m in metrics:
            w_vals = [r[m] for r in week_days if r.get(m) is not None]
            p_vals = [r[m] for r in prev_days if r.get(m) is not None]
            w_avg = (sum(w_vals) / len(w_vals)) if w_vals else None
            p_avg = (sum(p_vals) / len(p_vals)) if p_vals else None
            week_avgs[m] = round(w_avg, 1) if w_avg is not None else None
            prev_avgs[m] = round(p_avg, 1) if p_avg is not None else None

            if w_avg is not None and p_avg is not None and p_avg != 0:
                change = (w_avg - p_avg) / abs(p_avg)
                # For resting_hr and stress, lower is better so invert arrow
                inverted = m in ("resting_hr", "stress_avg")
                if abs(change) < 0.03:
                    trends[m] = "→"
                elif (change > 0) != inverted:
                    trends[m] = "↑"
                else:
                    trends[m] = "↓"
            else:
                trends[m] = "—"

        summaries.append({
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "averages": week_avgs,
            "trends": trends,
        })

    return summaries


# ── Correlations ───────────────────────────────────────────────────────────────

CORRELATION_PAIRS = [
    ("sleep_hours",    "hrv_rmssd",    1,  "Sleep → next-day HRV"),
    ("hrv_rmssd",      "resting_hr",   1,  "HRV → next-day resting HR"),
    ("daily_tss",      "resting_hr",   1,  "Training load → next-day resting HR"),
    ("daily_tss",      "hrv_rmssd",    1,  "Training load → next-day HRV"),
    ("stress_avg",     "sleep_hours",  1,  "Stress → next-night sleep"),
    ("body_battery_wake", "daily_tss", 0,  "Body battery → same-day training load"),
]


def compute_correlations(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Compute Pearson correlations for predefined metric pairs.
    lag: how many days to shift the second metric (1 = predictive).
    Returns pairs with r, sample size, and a plain-English interpretation.
    """
    results = []

    for x_key, y_key, lag, label in CORRELATION_PAIRS:
        xs, ys = [], []
        for i in range(len(history) - lag):
            x = history[i].get(x_key)
            y = history[i + lag].get(y_key)
            if x is not None and y is not None:
                xs.append(float(x))
                ys.append(float(y))

        if len(xs) < 14:
            continue

        r = _pearson(xs, ys)
        if r is None:
            continue

        results.append({
            "label": label,
            "x_metric": x_key,
            "y_metric": y_key,
            "lag_days": lag,
            "r": round(r, 3),
            "n": len(xs),
            "interpretation": _interpret_correlation(r, label, x_key, y_key, lag),
        })

    return sorted(results, key=lambda c: abs(c["r"]), reverse=True)


def _interpret_correlation(r: float, label: str, x: str, y: str, lag: int) -> str:
    strength = "strong" if abs(r) > 0.5 else "moderate" if abs(r) > 0.3 else "weak"
    direction = "positive" if r > 0 else "negative"

    if abs(r) < 0.2:
        return f"No meaningful relationship found between {label.lower()}."

    lag_str = f"the next day's" if lag == 1 else "same-day"

    # Specific interpretations
    if x == "sleep_hours" and y == "hrv_rmssd":
        if r > 0.3:
            return f"More sleep is {strength}ly associated with higher {lag_str} HRV (r={r:.2f}). Prioritising sleep improves your recovery signal."
        else:
            return f"Sleep duration has a {strength} {direction} correlation with {lag_str} HRV (r={r:.2f})."

    if x == "daily_tss" and y == "resting_hr":
        if r > 0.3:
            return f"Harder training days are {strength}ly linked to elevated {lag_str} resting HR (r={r:.2f}). Expect this — plan easy days after hard ones."
        else:
            return f"Training load has a {strength} link to {lag_str} resting HR (r={r:.2f})."

    if x == "hrv_rmssd" and y == "resting_hr":
        if r < -0.3:
            return f"Low HRV predicts elevated {lag_str} resting HR (r={r:.2f}), a reliable double-signal for poor recovery."

    return f"{strength.capitalize()} {direction} correlation (r={r:.2f}, n={lag_str})."


# ── Helpers ────────────────────────────────────────────────────────────────────

def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    n = len(s)
    return (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2)


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)
