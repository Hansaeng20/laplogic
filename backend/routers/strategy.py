"""Strategy endpoints.

* ``POST /api/strategy/optimize`` - automatic Strategy Advisor
* ``POST /api/strategy/compare``  - evaluate a user-planned strategy
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, File, Form, UploadFile

from core.analysis import start_lap_excess
from core.errors import DataError
from core.laps import classify_laps
from core.model import fit_pace_model
from core.parsing import load_session
from core.rules import resolve_rules
from core.strategy import (
    FUEL_SENSITIVITY_EFFECT,
    LIMITATIONS,
    PitLoss,
    build_plan,
    difference_uncertainty,
    optimize_strategy,
    resolve_pit_loss,
    stint_limit,
)
from core.uploads import read_csv_upload

router = APIRouter(prefix="/api/strategy", tags=["Race Strategy"])

StrategyType = Literal["one_stop", "two_stop"]


def _check_race_laps(race_laps: int, observed: int) -> None:
    if race_laps > observed * 2:
        raise DataError(
            f"A {race_laps}-lap race is more than twice the {observed} laps in this "
            "upload. Upload longer stint data before forecasting this race."
        )


async def _prepare(file: UploadFile, fuel_effect: float | None):
    contents, _ = await read_csv_upload(file)
    session = load_session(contents)
    laps = classify_laps(session.df)
    model = fit_pace_model(laps, fuel_effect=fuel_effect)
    return session, laps, model


@router.post("/optimize")
async def optimize(
    file: UploadFile = File(...),
    simulator: str = Form(""),
    race_laps: int | None = Form(None, ge=3, le=1000),
    pit_loss: float | None = Form(None, ge=0, le=300),
    fuel_effect: float | None = Form(None, ge=0, le=0.3),
    max_stops: int | None = Form(None, ge=0, le=3),
    require_compound_change: bool | None = Form(None),
    min_stint_laps: int | None = Form(None, ge=1, le=100),
):
    session, laps, model = await _prepare(file, fuel_effect)
    laps_total = race_laps or session.race_laps
    _check_race_laps(laps_total, session.race_laps)

    rules = resolve_rules(simulator, require_compound_change, max_stops, min_stint_laps)
    loss = resolve_pit_loss(laps, model, rules, pit_loss)
    sensitivity_model = (
        fit_pace_model(laps, fuel_effect=FUEL_SENSITIVITY_EFFECT)
        if model is not None and model.fuel_mode == "none"
        else None
    )
    result = optimize_strategy(
        laps, model, rules, laps_total, loss,
        start_lap_excess(laps, model), sensitivity_model,
    )
    result["warnings"] = session.warnings + result["warnings"]
    return result


@router.post("/compare")
async def compare_strategies(
    file: UploadFile = File(...),
    race_laps: int = Form(..., ge=5, le=500),
    strategy_type: StrategyType = Form("one_stop"),
    first_pit_lap: int = Form(...),
    second_pit_lap: int | None = Form(None),
    first_compound: str = Form(..., min_length=1, max_length=40),
    second_compound: str = Form(..., min_length=1, max_length=40),
    third_compound: str = Form("", max_length=40),
    pit_loss: float = Form(25.0, ge=0, le=300),
    simulator: str = Form(""),
    fuel_effect: float | None = Form(None, ge=0, le=0.3),
):
    session, laps, model = await _prepare(file, fuel_effect)
    _check_race_laps(race_laps, session.race_laps)

    stints = _planned_stints(
        strategy_type, race_laps, first_pit_lap, second_pit_lap,
        first_compound, second_compound, third_compound,
    )

    rules = resolve_rules(simulator)
    loss = PitLoss(seconds=pit_loss, uncertainty=0.0, source="user")
    fixed = (model.fuel_total(race_laps) + start_lap_excess(laps, model)) if model else 0.0

    user_result, user_plan = _evaluate("Your Strategy", stints, model, rules, race_laps, loss, fixed)

    # Alternative: the optimizer's best plan with a different number of stops.
    alternative_result = None
    if model is not None:
        optimized = optimize_strategy(laps, model, rules, race_laps, loss)
        user_stops = len(stints) - 1
        options = [a for a in optimized["alternatives"] if a["stops"] != user_stops]
        if options:
            best = min(options, key=lambda a: a["total_time"])
            alt_stints = [(s["compound"], s["laps"]) for s in best["stints"]]
            alternative_result, alt_plan = _evaluate(
                f"Laplogic best {best['stops']}-stop", alt_stints, model, rules,
                race_laps, loss, fixed,
            )
            if user_plan is not None and alt_plan is not None:
                alternative_result["uncertainty_vs_yours"] = round(
                    difference_uncertainty(alt_plan, user_plan, model, loss), 3
                )

    results = [user_result] + ([alternative_result] if alternative_result else [])
    supported = sorted(
        (r for r in results if r["supported"]), key=lambda r: r["estimated_total_time"]
    )
    for rank, r in enumerate(supported, 1):
        r["rank"] = rank

    clean = laps[laps["is_clean"]]
    profiles = {}
    if model is not None:
        for c, fit in model.compounds.items():
            group = clean[clean["compound"] == c]
            profiles[c] = {
                "average_lap": round(float(group["lap_seconds"].mean()), 3),
                "sample_laps": fit.clean_laps,
                "max_observed_age": fit.max_age,
                "degradation_per_lap": round(fit.degradation, 4),
            }

    return {
        "status": "success",
        "race_laps": race_laps,
        "observed_laps": session.race_laps,
        "pit_loss_assumption": pit_loss,
        "pace_profiles": profiles,
        "strategies": results,
        "recommended": supported[0]["strategy"] if supported else None,
        "experimental": True,
        "method": (
            "Per-compound pace and linear tyre wear fitted to your clean laps, "
            "summed over each planned stint, plus the pit loss per stop."
        ),
        "limitations": LIMITATIONS,
    }


def _planned_stints(
    strategy_type: str,
    race_laps: int,
    first_pit: int,
    second_pit: int | None,
    first: str,
    second: str,
    third: str,
) -> list[tuple[str, int]]:
    norm = [c.strip().upper() for c in (first, second, third)]
    if not 1 <= first_pit <= race_laps - 1:
        raise DataError("First pit lap is outside the race.")
    if strategy_type == "one_stop":
        return [(norm[0], first_pit), (norm[1], race_laps - first_pit)]
    if second_pit is None:
        raise DataError("A two-stop strategy needs second_pit_lap.")
    if not first_pit + 1 <= second_pit <= race_laps - 1:
        raise DataError("Second pit lap must come after the first and before the finish.")
    if not norm[2]:
        raise DataError("A two-stop strategy needs third_compound.")
    return [
        (norm[0], first_pit),
        (norm[1], second_pit - first_pit),
        (norm[2], race_laps - second_pit),
    ]


def _evaluate(name, stints, model, rules, race_laps, loss, fixed):
    if model is None:
        return {
            "strategy": name,
            "supported": False,
            "reason": "Not enough clean laps to model tyre pace.",
        }, None

    for compound, length in stints:
        if not model.supports(compound):
            reason = model.excluded.get(compound, "Compound not present in this upload.")
            return {
                "strategy": name,
                "supported": False,
                "reason": f"{compound}: {reason}",
            }, None
        limit = max(stint_limit(model, compound, rules, race_laps), model.compounds[compound].max_age)
        if length > limit:
            return {
                "strategy": name,
                "supported": False,
                "reason": (
                    f"A {length}-lap {compound} stint is beyond the supported "
                    f"{limit} laps (longest recorded: {model.compounds[compound].max_age})."
                ),
            }, None

    plan = build_plan(name, stints, model, loss)
    warnings = [
        f"{c} stint of {n} laps extends beyond your longest recorded run."
        for (c, n), extra in zip(stints, plan.extrapolated) if extra
    ]
    breakdown, start = [], 1
    for compound, length in stints:
        t = model.stint_display_time(compound, start, length)
        breakdown.append({
            "start_lap": start,
            "end_lap": start + length - 1,
            "compound": compound,
            "laps": length,
            "estimated_time": round(t, 3),
            "estimated_average_lap": round(t / length, 3),
        })
        start += length

    return {
        "strategy": name,
        "supported": True,
        "pit_stops": plan.stops,
        "stints": breakdown,
        "estimated_racing_time": round(plan.racing_time + fixed, 3),
        "pit_loss_total": round(plan.pit_time, 3),
        "estimated_total_time": round(plan.total + fixed, 3),
        "warnings": warnings,
    }, plan
