"""Race performance analysis built on a parsed :class:`Session`."""

from __future__ import annotations

from collections import Counter

import numpy as np
import pandas as pd

from .laps import EXCLUSION_LABELS, classify_laps
from .model import PaceModel, fit_pace_model
from .parsing import Session
from .strategy import measure_pit_losses

PIT_SOURCE_LABELS = {
    "column": "pit_stop column",
    "stint_column": "stint number changes",
    "tyre_age": "tyre age resets",
    "compound_change": "tyre compound changes (inferred)",
}


def _r(value, digits: int = 3):
    if value is None:
        return None
    value = float(value)
    return None if not np.isfinite(value) else round(value, digits)


def start_lap_excess(laps: pd.DataFrame, model: PaceModel | None) -> float:
    """Extra time on lap 1 versus modelled pace (shared by all strategies)."""
    first = laps[laps["lap"] == 1]
    if model is None or first.empty:
        return 0.0
    row = first.iloc[0]
    if not model.supports(row["compound"]):
        return 0.0
    return float(row["lap_seconds"] - model.predict_lap(row["compound"], int(row["tyre_age"]), 1))


def _trend(group: pd.DataFrame) -> float | None:
    clean = group[group["is_clean"]]
    if len(clean) < 3 or clean["tyre_age"].nunique() < 3:
        return None
    slope, _ = np.polyfit(clean["tyre_age"].astype(float), clean["lap_seconds"].astype(float), 1)
    return float(slope)


def consistency_label(std: float) -> str:
    if std < 0.3:
        return "very consistent"
    if std < 0.6:
        return "consistent"
    if std < 1.0:
        return "moderately consistent"
    return "inconsistent"


def analyze_session(session: Session, filename: str) -> dict:
    laps = classify_laps(session.df)
    model = fit_pace_model(laps)
    times = laps["lap_seconds"]
    clean = laps[laps["is_clean"]]

    valid_laps = laps[laps["valid"]]
    best_pool = valid_laps if not valid_laps.empty else laps
    best_idx = best_pool["lap_seconds"].idxmin()
    fastest = float(laps.at[best_idx, "lap_seconds"])
    average = float(times.mean())

    clean_avg = float(clean["lap_seconds"].mean()) if len(clean) else None
    # Driver consistency = spread left after removing tyre wear and fuel
    # trends; raw lap-time spread would blame the driver for tyre wear.
    if model is not None:
        clean_std = model.residual_std
    else:
        clean_std = float(clean["lap_seconds"].std(ddof=0)) if len(clean) >= 2 else None

    # Pit stops --------------------------------------------------------
    loss_by_lap = measure_pit_losses(laps, model)

    stops = []
    for row in laps[laps["is_pit_stop"]].itertuples(index=False):
        after = laps[laps["lap"] > row.lap]
        stops.append({
            "lap": int(row.lap),
            "compound_before": row.compound,
            "compound_after": after.iloc[0]["compound"] if not after.empty else None,
            "duration": _r(row.pit_seconds),
            "time_loss": _r(loss_by_lap.get(int(row.lap))),
        })
    durations = [s["duration"] for s in stops if s["duration"] is not None]
    measured = [s["time_loss"] for s in stops if s["time_loss"] is not None]

    # Stints -----------------------------------------------------------
    stints = []
    for number, group in laps.groupby("stint", sort=True):
        compounds = group["compound"].unique().tolist()
        compound = compounds[0] if len(compounds) == 1 else "MIXED"
        g_clean = group[group["is_clean"]]
        fit = model.compounds.get(compound) if model else None
        stints.append({
            "stint_number": int(number),
            "start_lap": int(group["lap"].min()),
            "end_lap": int(group["lap"].max()),
            "recorded_laps": int(len(group)),
            "compound": compound,
            "average_lap": _r(group["lap_seconds"].mean()),
            "clean_average_lap": _r(g_clean["lap_seconds"].mean()) if len(g_clean) else None,
            "best_lap": _r(group["lap_seconds"].min()),
            "clean_laps": int(len(g_clean)),
            "pace_trend_per_lap": _r(_trend(group), 4),
            "degradation_per_lap": (
                _r(fit.degradation, 4) if fit and not fit.degradation_constrained
                else (0.0 if fit else None)
            ),
        })

    # Lap table ----------------------------------------------------------
    laps_out = []
    cumulative = times.cumsum()
    for i, row in enumerate(laps.itertuples(index=False)):
        laps_out.append({
            "lap": int(row.lap),
            "lap_time": round(float(row.lap_seconds), 3),
            "compound": row.compound,
            "is_pit_stop": bool(row.is_pit_stop),
            "pit_duration": _r(row.pit_seconds),
            "delta_to_best": round(float(row.lap_seconds) - fastest, 3),
            "delta_to_average": round(float(row.lap_seconds) - average, 3),
            "cumulative_time": round(float(cumulative.iloc[i]), 3),
            "stint": int(row.stint),
            "tyre_age": int(row.tyre_age),
            "valid": bool(row.valid),
            "is_out_lap": bool(row.is_out_lap),
            "is_outlier": bool(row.is_outlier),
            "is_clean": bool(row.is_clean),
            "exclusion": EXCLUSION_LABELS.get(row.exclusion) if row.exclusion else None,
        })

    excluded = Counter(r for r in laps["exclusion"] if r)

    return {
        "status": "success",
        "filename": filename,
        "analysis_type": "race_performance",
        "circuit": session.circuit,
        "total_laps": int(len(laps)),
        "race_laps": session.race_laps,
        "compounds": sorted(laps["compound"].unique().tolist()),
        "statistics": {
            "fastest_lap": round(fastest, 3),
            "slowest_lap": round(float(times.max()), 3),
            "average_lap": round(average, 3),
            "median_lap": round(float(times.median()), 3),
            "consistency_std": round(float(times.std(ddof=0)), 3),
            "best_lap_number": int(laps.at[best_idx, "lap"]),
            "total_recorded_time": round(float(times.sum()), 3),
            "clean_laps": int(len(clean)),
            "clean_average_lap": _r(clean_avg),
            "clean_consistency_std": _r(clean_std),
            "consistency_label": consistency_label(clean_std) if clean_std is not None else None,
        },
        "pit_analysis": {
            "available": session.pit_source is not None or "pit_stop" in session.columns,
            "source": session.pit_source,
            "source_label": PIT_SOURCE_LABELS.get(session.pit_source or ""),
            "total_pit_stops": len(stops),
            "stops": stops,
            "recorded_duration_count": len(durations),
            "total_recorded_pit_duration": _r(sum(durations)) if durations else None,
            "average_time_loss": _r(np.median(measured)) if measured else None,
            "duration_is_additional_to_lap_time": False,
        },
        "stints": stints,
        "laps": laps_out,
        "data_quality": {
            "detected_columns": session.columns,
            "lap_time_unit": session.lap_time_unit,
            "dropped_rows": session.dropped_rows,
            "excluded_laps": {EXCLUSION_LABELS[k]: v for k, v in excluded.items()},
            "warnings": session.warnings,
        },
        "insights": build_insights(laps, model, fastest, clean_avg, clean_std, measured),
        "notes": [
            "Lap times and durations are expressed in seconds.",
            "Clean laps exclude lap 1, pit in/out laps, invalidated laps and outliers.",
            "Pit time loss = in-lap plus out-lap time above modelled racing pace.",
            "Recorded pit durations are shown as exported; definitions vary by simulator.",
        ],
    }


def build_insights(
    laps: pd.DataFrame,
    model: PaceModel | None,
    fastest: float,
    clean_avg: float | None,
    clean_std: float | None,
    pit_losses: list[float],
) -> list[dict]:
    insights: list[dict] = []

    if clean_std is not None:
        label = consistency_label(clean_std)
        insights.append({
            "level": "positive" if clean_std < 0.6 else "info" if clean_std < 1.0 else "warning",
            "title": f"Race pace is {label}",
            "detail": (
                f"After removing tyre-wear and fuel trends, your clean laps vary by "
                f"±{clean_std:.3f}s (standard deviation). As a rule of thumb, under 0.5s "
                "is strong race consistency."
            ),
        })

    if clean_avg is not None and clean_avg - fastest > 0.05:
        insights.append({
            "level": "info",
            "title": "Pace left on the table",
            "detail": (
                f"Your best lap is {clean_avg - fastest:.3f}s faster than your clean "
                "average. Part of that gap is tyre wear and fuel, but repeating your "
                "best lines more often is the biggest opportunity."
            ),
        })

    if model is not None:
        worn = [
            f for f in model.compounds.values()
            if not f.degradation_constrained and f.degradation > 0
        ]
        if worn:
            worst = max(worn, key=lambda f: f.degradation)
            insights.append({
                "level": "warning" if worst.degradation >= 0.1 else "info",
                "title": f"{worst.compound} wears fastest",
                "detail": (
                    f"About {worst.degradation:.3f}s slower for every lap of tyre age. "
                    f"Over a {worst.max_age}-lap stint that adds up to "
                    f"{worst.degradation * worst.max_age * (worst.max_age + 1) / 2:.1f}s."
                    + (
                        " Fuel burn is mixed into this figure, so true wear is likely higher."
                        if model.fuel_mode == "none" else ""
                    )
                ),
            })

    outliers = laps[laps["is_outlier"]]["lap"].tolist()
    if outliers:
        shown = ", ".join(map(str, outliers[:6])) + ("…" if len(outliers) > 6 else "")
        insights.append({
            "level": "info",
            "title": f"{len(outliers)} unusual lap(s) set aside",
            "detail": (
                f"Lap(s) {shown} were much slower or faster than your rhythm "
                "(incident, traffic or track cut) and are excluded from pace modelling."
            ),
        })

    invalid = int((~laps["valid"]).sum())
    if invalid:
        insights.append({
            "level": "warning",
            "title": f"{invalid} invalidated lap(s)",
            "detail": "These laps were flagged invalid by the simulator and are not used for pace.",
        })

    if pit_losses:
        insights.append({
            "level": "info",
            "title": f"Each pit stop cost about {np.median(pit_losses):.1f}s",
            "detail": "Measured as in-lap plus out-lap time above your modelled racing pace.",
        })

    return insights
