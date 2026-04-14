from datetime import date, timedelta


def calculate_tss_from_hr(
    duration_sec: int, avg_hr: float, threshold_hr: float
) -> float:
    """
    TSS based on heart rate.
    IF = avg_hr / threshold_hr
    TSS = (duration_sec * IF^2) / 3600 * 100
    """
    intensity_factor = avg_hr / threshold_hr
    tss = (duration_sec * intensity_factor**2) / 3600 * 100
    return round(tss, 1)


def calculate_tss_from_power(
    duration_sec: int, normalized_power: float, ftp: float
) -> float:
    """
    Standard power-based TSS (used when a power meter is present).
    IF = NP / FTP
    TSS = (duration_sec * NP * IF) / (FTP * 3600) * 100
    """
    intensity_factor = normalized_power / ftp
    tss = (duration_sec * normalized_power * intensity_factor) / (ftp * 3600) * 100
    return round(tss, 1)


def calculate_hr_zones(max_hr: int) -> dict[str, dict[str, int | str]]:
    """Standard 5-zone model based on percentage of max HR."""
    return {
        "z1": {"name": "Easy", "min": int(max_hr * 0.50), "max": int(max_hr * 0.60)},
        "z2": {"name": "Aerobic", "min": int(max_hr * 0.60), "max": int(max_hr * 0.70)},
        "z3": {"name": "Tempo", "min": int(max_hr * 0.70), "max": int(max_hr * 0.80)},
        "z4": {"name": "Threshold", "min": int(max_hr * 0.80), "max": int(max_hr * 0.90)},
        "z5": {"name": "VO2max", "min": int(max_hr * 0.90), "max": max_hr},
    }


def calculate_training_load(
    daily_tss: dict[date, float]
) -> dict[date, dict[str, float]]:
    """
    Fitness-fatigue model (ATL/CTL/TSB).

    CTL (Chronic Training Load / fitness) — 42-day EMA of daily TSS
    ATL (Acute Training Load / fatigue) — 7-day EMA of daily TSS
    TSB (Training Stress Balance / form) — CTL minus ATL

    Returns a dict keyed by date with {"ctl", "atl", "tsb"} for each day.
    Dates with no activity are treated as 0 TSS and still advance the EMAs.
    """
    CTL_DAYS = 42
    ATL_DAYS = 7

    ctl_decay = 1 - (1 / CTL_DAYS)  # ≈ 0.9762
    atl_decay = 1 - (1 / ATL_DAYS)  # ≈ 0.8571

    if not daily_tss:
        return {}

    start = min(daily_tss)
    end = max(daily_tss)

    ctl, atl = 0.0, 0.0
    results: dict[date, dict[str, float]] = {}
    current = start

    while current <= end:
        tss = daily_tss.get(current, 0.0)
        ctl = ctl * ctl_decay + tss * (1 - ctl_decay)
        atl = atl * atl_decay + tss * (1 - atl_decay)
        tsb = ctl - atl
        results[current] = {
            "ctl": round(ctl, 1),
            "atl": round(atl, 1),
            "tsb": round(tsb, 1),
            "daily_tss": tss,
        }
        current += timedelta(days=1)

    return results
