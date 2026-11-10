"""Lap classification: which laps represent representative racing pace.

A lap is *clean* when it can be used to estimate tyre pace:

* not lap 1 (standing/rolling start distorts it)
* not an in-lap (marked pit stop) or an out-lap (first lap after a stop)
* not invalidated by the simulator
* not a statistical outlier (spin, traffic, safety car, cut track)

All laps stay in the data; classification only adds columns.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Robust z-score threshold (Iglewicz & Hoaglin's modified z-score).
OUTLIER_Z = 3.5
# Laps this much slower than the clean median are never representative
# (safety car, spin, long off). Mirrors the spirit of the 107% rule.
SLOW_LAP_RATIO = 1.07
# Floor for the robust spread so very consistent drivers do not have
# ordinary small mistakes (< ~0.8s) flagged as outliers.
MIN_MAD_SECONDS = 0.15

EXCLUSION_LABELS = {
    "first_lap": "Race start lap",
    "in_lap": "Pit in-lap",
    "out_lap": "Pit out-lap",
    "invalid": "Invalidated by simulator",
    "slow": "Far slower than typical pace",
    "outlier": "Statistical outlier",
}


def _trend_residuals(laps: pd.DataFrame) -> pd.Series:
    """Residuals from a robust per-stint linear trend (Theil-Sen).

    The median of pairwise slopes follows tyre wear without being pulled
    by the very outliers we are trying to find, and has no edge bias.
    """
    residuals = pd.Series(0.0, index=laps.index)
    for _, stint in laps.groupby("stint"):
        t = stint["lap_seconds"].to_numpy(dtype=float)
        a = stint["tyre_age"].to_numpy(dtype=float)
        if len(stint) >= 4:
            i, j = np.triu_indices(len(stint), k=1)
            da = a[j] - a[i]
            valid = da != 0
            slope = float(np.median((t[j] - t[i])[valid] / da[valid])) if valid.any() else 0.0
            intercept = float(np.median(t - slope * a))
            residuals[stint.index] = t - (intercept + slope * a)
        else:
            residuals[stint.index] = t - float(np.median(t))
    return residuals


def classify_laps(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of ``df`` with ``is_out_lap``, ``is_outlier``,
    ``is_clean`` and ``exclusion`` columns."""
    out = df.copy()

    out["is_out_lap"] = (
        out["is_pit_stop"].shift(fill_value=False).astype(bool)
    )

    reason = pd.Series("", index=out.index, dtype=object)
    reason[out["lap"].eq(1)] = "first_lap"
    reason[(reason == "") & out["is_pit_stop"]] = "in_lap"
    reason[(reason == "") & out["is_out_lap"]] = "out_lap"
    reason[(reason == "") & ~out["valid"]] = "invalid"

    candidates = reason == ""
    times = out["lap_seconds"]

    if candidates.sum() >= 3:
        median = float(times[candidates].median())
        slow = candidates & (times > median * SLOW_LAP_RATIO)
        reason[slow] = "slow"
        candidates &= ~slow

    if candidates.sum() >= 5:
        residual = _trend_residuals(out[candidates])
        mad = max(float(np.median(np.abs(residual - residual.median()))), MIN_MAD_SECONDS)
        z = 0.6745 * (residual - residual.median()) / mad
        flagged = z.index[np.abs(z) > OUTLIER_Z]
        reason[flagged] = "outlier"

    out["exclusion"] = reason
    out["is_outlier"] = reason.isin(["slow", "outlier"])
    out["is_clean"] = reason == ""
    return out
