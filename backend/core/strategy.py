"""Race strategy evaluation and optimization.

Given a fitted :class:`~core.model.PaceModel`, every feasible strategy
(0..max stops, any combination of supported compounds, every split of the
race into stints) is evaluated exactly with dynamic programming.

Under the model a stint's time depends only on its compound and length,
not on where it sits in the race (the shared fuel term is identical for
all strategies). Strategies are therefore enumerated as *multisets* of
compounds; the displayed stint order keeps the recorded starting tyre
first.

Uncertainty of "plan A is faster than plan B" combines the parameter
covariance of the pace model with the pit-loss uncertainty, giving a
standard error and a probability that the recommendation is faster.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations_with_replacement
from math import ceil, erf, sqrt

import numpy as np
import pandas as pd

from .model import PaceModel
from .parsing import WET_COMPOUNDS
from .rules import SimulatorRules

# Allow stints up to 20% longer than the longest observed run on a
# compound. Beyond that, a linear wear model cannot see a tyre "cliff".
EXTRAPOLATION_FACTOR = 1.2
# Gains below this are indistinguishable from normal lap-to-lap noise.
MEANINGFUL_GAIN_SECONDS = 0.5
# A pit stop can be moved within this many seconds of the optimum.
PIT_WINDOW_TOLERANCE = 0.5
MIN_MEASURED_PIT_LOSS = 2.0
# Plausible fuel burn-off (s/lap) used to test recommendations for robustness
# when the data cannot measure it. Typical sim values are 0.02-0.08 s/lap.
FUEL_SENSITIVITY_EFFECT = 0.05
ASSUMED_PIT_LOSS_REL_UNCERTAINTY = 0.35


# ------------------------------------------------------------------
# Pit loss
# ------------------------------------------------------------------

@dataclass
class PitLoss:
    seconds: float
    uncertainty: float
    source: str  # measured | user | assumed
    samples: list[float] = field(default_factory=list)
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "seconds": round(self.seconds, 3),
            "uncertainty": round(self.uncertainty, 3),
            "source": self.source,
            "samples": [round(s, 3) for s in self.samples],
            "note": self.note,
        }


def measure_pit_losses(laps: pd.DataFrame, model: PaceModel | None) -> dict[int, float]:
    """Time lost per recorded stop (keyed by in-lap): in-lap excess + out-lap excess."""
    if model is None:
        return {}
    by_lap = laps.set_index("lap")
    losses: dict[int, float] = {}
    for row in laps[laps["is_pit_stop"]].itertuples(index=False):
        nxt = row.lap + 1
        if nxt not in by_lap.index:
            continue
        out = by_lap.loc[nxt]
        if not (model.supports(row.compound) and model.supports(out["compound"])):
            continue
        in_excess = row.lap_seconds - model.predict_lap(row.compound, row.tyre_age, row.lap)
        out_excess = out["lap_seconds"] - model.predict_lap(out["compound"], int(out["tyre_age"]), nxt)
        losses[int(row.lap)] = float(in_excess + out_excess)
    return losses


def resolve_pit_loss(
    laps: pd.DataFrame,
    model: PaceModel | None,
    rules: SimulatorRules,
    override: float | None,
) -> PitLoss:
    samples = list(measure_pit_losses(laps, model).values())

    if override is not None:
        return PitLoss(
            seconds=float(override),
            uncertainty=0.0,
            source="user",
            samples=samples,
            note="User-supplied value; its own error is not included in the uncertainty.",
        )

    if samples and float(np.median(samples)) >= MIN_MEASURED_PIT_LOSS:
        value = float(np.median(samples))
        noise = sqrt(2) * (model.residual_std if model else 0.5)
        if len(samples) >= 2:
            spread = float(np.std(samples, ddof=1))
            uncertainty = max(spread, noise) / sqrt(len(samples))
        else:
            uncertainty = max(2 * noise, 0.1 * value)
        return PitLoss(
            seconds=value,
            uncertainty=uncertainty,
            source="measured",
            samples=samples,
            note=(
                f"Measured from {len(samples)} recorded stop(s): in-lap plus "
                "out-lap time above modelled racing pace."
            ),
        )

    note = (
        f"No usable pit stop could be measured; using a typical "
        f"{rules.label} value. Set your own pit loss for better accuracy."
    )
    if samples:
        note = (
            "Recorded pit laps were not noticeably slower than racing laps, "
            "so the export may exclude pit-lane time. " + note
        )
    value = rules.default_pit_loss
    return PitLoss(
        seconds=value,
        uncertainty=ASSUMED_PIT_LOSS_REL_UNCERTAINTY * value,
        source="assumed",
        samples=samples,
        note=note,
    )


# ------------------------------------------------------------------
# Plans
# ------------------------------------------------------------------

@dataclass
class Plan:
    label: str
    stints: list[tuple[str, int]]  # (compound, laps) in race order
    racing_time: float
    degradation_time: float
    pit_time: float
    vector: np.ndarray
    extrapolated: list[bool]

    @property
    def stops(self) -> int:
        return len(self.stints) - 1

    @property
    def total(self) -> float:
        return self.racing_time + self.pit_time

    def signature(self) -> tuple:
        return tuple(sorted(self.stints))

    def pit_laps(self) -> list[int]:
        laps, total = [], 0
        for _, length in self.stints[:-1]:
            total += length
            laps.append(total)
        return laps


def stint_limit(model: PaceModel, compound: str, rules: SimulatorRules, race_laps: int) -> int:
    observed = model.compounds[compound].max_age
    return min(race_laps, max(rules.min_stint_laps, ceil(observed * EXTRAPOLATION_FACTOR)))


def build_plan(
    label: str,
    stints: list[tuple[str, int]],
    model: PaceModel,
    pit_loss: PitLoss,
) -> Plan:
    vector = np.zeros(len(model.params))
    racing = degradation = 0.0
    extrapolated = []
    for compound, length in stints:
        racing += model.stint_time(compound, length)
        degradation += model.stint_degradation_time(compound, length)
        vector += model.stint_vector(compound, length)
        extrapolated.append(length > model.compounds[compound].max_age)
    return Plan(
        label=label,
        stints=stints,
        racing_time=racing,
        degradation_time=degradation,
        pit_time=(len(stints) - 1) * pit_loss.seconds,
        vector=vector,
        extrapolated=extrapolated,
    )


def difference_uncertainty(a: Plan, b: Plan, model: PaceModel, pit_loss: PitLoss) -> float:
    """One standard error of ``a.total - b.total``."""
    d = a.vector - b.vector
    variance = float(d @ model.cov @ d) + ((a.stops - b.stops) * pit_loss.uncertainty) ** 2
    return sqrt(max(variance, 0.0))


def _optimal_split(
    compounds: tuple[str, ...],
    model: PaceModel,
    rules: SimulatorRules,
    race_laps: int,
) -> tuple[list[int] | None, int]:
    """Best stint lengths for a compound multiset, and the number of
    feasible splits (for reporting the search size)."""
    n = race_laps
    inf = np.inf
    dp = np.full(n + 1, inf)
    dp[0] = 0.0
    count = np.zeros(n + 1)
    count[0] = 1
    choices = []

    for c in compounds:
        limit = stint_limit(model, c, rules, n)
        new = np.full(n + 1, inf)
        arg = np.zeros(n + 1, dtype=int)
        new_count = np.zeros(n + 1)
        for length in range(rules.min_stint_laps, limit + 1):
            cand = np.full(n + 1, inf)
            cand[length:] = dp[: n + 1 - length] + model.stint_time(c, length)
            better = cand < new
            new[better] = cand[better]
            arg[better] = length
            new_count[length:] += count[: n + 1 - length]
        dp, count = new, new_count
        choices.append(arg)

    if not np.isfinite(dp[n]):
        return None, 0

    lengths, remaining = [], n
    for arg in reversed(choices):
        length = int(arg[remaining])
        lengths.append(length)
        remaining -= length
    return list(reversed(lengths)), int(count[n])


def _order_stints(
    stints: list[tuple[str, int]],
    preferred_order: list[str],
) -> list[tuple[str, int]]:
    rank = {c: i for i, c in enumerate(preferred_order)}
    return sorted(stints, key=lambda s: (rank.get(s[0], len(rank)), s[0], -s[1]))


def pit_windows(plan: Plan, model: PaceModel, rules: SimulatorRules, race_laps: int) -> list[dict]:
    windows = []
    boundaries = plan.pit_laps()
    for i, lap in enumerate(boundaries):
        (ca, la), (cb, lb) = plan.stints[i], plan.stints[i + 1]
        base = model.stint_time(ca, la) + model.stint_time(cb, lb)
        lim_a = stint_limit(model, ca, rules, race_laps)
        lim_b = stint_limit(model, cb, rules, race_laps)

        def ok(delta: int) -> bool:
            na, nb = la + delta, lb - delta
            if not (rules.min_stint_laps <= na <= max(lim_a, la)):
                return False
            if not (rules.min_stint_laps <= nb <= max(lim_b, lb)):
                return False
            cost = model.stint_time(ca, na) + model.stint_time(cb, nb) - base
            return cost <= PIT_WINDOW_TOLERANCE

        early = 0
        while ok(early - 1):
            early -= 1
        late = 0
        while ok(late + 1):
            late += 1
        windows.append({"pit": i + 1, "lap": lap, "earliest": lap + early, "latest": lap + late})
    return windows


def plan_to_dict(
    plan: Plan,
    model: PaceModel,
    rules: SimulatorRules,
    race_laps: int,
    baseline: Plan | None,
    pit_loss: PitLoss,
    fixed_total: float,
) -> dict:
    stints, start = [], 1
    for i, ((compound, length), extra) in enumerate(zip(plan.stints, plan.extrapolated)):
        fit = model.compounds[compound]
        shown = model.stint_display_time(compound, start, length)
        stints.append({
            "stint": i + 1,
            "compound": compound,
            "start_lap": start,
            "end_lap": start + length - 1,
            "laps": length,
            "extrapolated": extra,
            "estimated_time": round(shown, 3),
            "estimated_average_lap": round(shown / length, 3),
            "degradation_time": round(model.stint_degradation_time(compound, length), 3),
            "degradation_per_lap": round(fit.degradation, 4),
        })
        start += length

    delta = uncertainty = None
    if baseline is not None:
        delta = plan.total - baseline.total
        uncertainty = difference_uncertainty(plan, baseline, model, pit_loss)

    return {
        "label": plan.label,
        "stops": plan.stops,
        "pit_laps": plan.pit_laps(),
        "stints": stints,
        "racing_time": round(plan.racing_time + fixed_total, 3),
        "degradation_time": round(plan.degradation_time, 3),
        "pit_time": round(plan.pit_time, 3),
        "total_time": round(plan.total + fixed_total, 3),
        "delta_to_recorded": None if delta is None else round(delta, 3),
        "delta_uncertainty": None if uncertainty is None else round(uncertainty, 3),
        "pit_windows": pit_windows(plan, model, rules, race_laps),
        "extrapolated": any(plan.extrapolated),
    }


def _normal_cdf(x: float) -> float:
    return 0.5 * (1 + erf(x / sqrt(2)))


def _fmt(seconds: float) -> str:
    return f"{seconds:.1f}s"


def _stop_word(stops: int) -> str:
    return {0: "no-stop", 1: "one-stop", 2: "two-stop", 3: "three-stop"}.get(stops, f"{stops}-stop")


# ------------------------------------------------------------------
# Main entry point
# ------------------------------------------------------------------

def optimize_strategy(
    laps: pd.DataFrame,
    model: PaceModel | None,
    rules: SimulatorRules,
    race_laps: int,
    pit_loss: PitLoss,
    start_lap_excess: float = 0.0,
    sensitivity_model: PaceModel | None = None,
) -> dict:
    """Search all supported strategies and compare with the recorded one.

    ``sensitivity_model`` is the same data fitted under a plausible fuel
    effect. When fuel burn cannot be measured, the change in predicted gain
    between the two models is added to the uncertainty, so a recommendation
    is only made when it holds under both assumptions.
    """
    warnings: list[str] = []
    eligible = sorted(
        c for c in (model.compounds if model else {})
        if c not in WET_COMPOUNDS and c not in {"MIXED"}
    )

    # Recorded strategy ----------------------------------------------
    recorded_stints: list[tuple[str, int]] = []
    for _, group in laps.groupby("stint", sort=True):
        compounds = group["compound"].unique().tolist()
        compound = compounds[0] if len(compounds) == 1 else "MIXED"
        recorded_stints.append((compound, int(group["lap"].max() - group["lap"].min() + 1)))

    preferred = [c for c, _ in recorded_stints]
    recorded_reason = None
    if laps["lap"].min() != 1 or race_laps != int(laps["lap"].max()):
        recorded_reason = "The upload does not cover the full race distance being planned."
    elif any(c == "MIXED" for c, _ in recorded_stints):
        recorded_reason = "A recorded stint mixes compounds without a marked pit stop."
    elif any(c in WET_COMPOUNDS for c, _ in recorded_stints):
        recorded_reason = "The recorded race used wet-weather tyres; dry optimization does not apply."
    elif model is None or any(not model.supports(c) for c, _ in recorded_stints):
        missing = sorted({c for c, _ in recorded_stints if model is None or not model.supports(c)})
        recorded_reason = (
            f"Not enough clean laps to model {', '.join(missing)}, so the recorded "
            "strategy cannot be re-simulated."
        )

    base_payload = {
        "status": "success",
        "advisor": "Laplogic Strategy Advisor v2",
        "race_laps": race_laps,
        "simulator": {
            "key": rules.key,
            "label": rules.label,
            "require_compound_change": rules.require_compound_change,
            "max_stops": rules.max_stops,
            "min_stint_laps": rules.min_stint_laps,
            "note": rules.note,
        },
        "pit_loss": pit_loss.to_dict(),
        "warnings": warnings,
    }

    if model is None or not eligible:
        return {
            **base_payload,
            "verdict": {
                "code": "unsupported",
                "title": "Not enough data for a strategy recommendation",
                "summary": (
                    "Laplogic needs at least 4 clean laps with varying tyre age on a "
                    "dry compound to estimate pace and wear. Upload a longer race stint."
                ),
                "confidence": "n/a",
            },
            "recorded": None,
            "recorded_reason": recorded_reason,
            "recommended": None,
            "alternatives": [],
            "gain": None,
            "explanation": [],
            "model": model_summary(model, rules, race_laps),
            "search": {"tyre_combinations": 0, "feasible_strategies": 0},
            "assumptions": assumptions(model, pit_loss),
            "limitations": LIMITATIONS,
        }

    # Fixed components shared by every plan of this race length.
    fixed_total = model.fuel_total(race_laps) + start_lap_excess

    recorded = None
    if recorded_reason is None:
        recorded = build_plan("Your recorded strategy", recorded_stints, model, pit_loss)
        if rules.require_compound_change and len({c for c, _ in recorded_stints}) < 2:
            warnings.append(
                f"Your recorded strategy uses one compound, which breaks the {rules.label} "
                "compound-change rule; it is shown for reference."
            )

    # Search ---------------------------------------------------------
    best_by_stops: dict[int, Plan] = {}
    combos = feasible = 0
    max_stops = min(rules.max_stops, race_laps // max(rules.min_stint_laps, 1) - 1)

    for stops in range(0, max_stops + 1):
        for multiset in combinations_with_replacement(eligible, stops + 1):
            if rules.require_compound_change and len(set(multiset)) < 2:
                continue
            lengths, count = _optimal_split(multiset, model, rules, race_laps)
            combos += 1
            feasible += count
            if lengths is None:
                continue
            stints = _order_stints(list(zip(multiset, lengths)), preferred)
            plan = build_plan(f"Best {_stop_word(stops)}", stints, model, pit_loss)
            current = best_by_stops.get(stops)
            if current is None or plan.total < current.total - 1e-9:
                best_by_stops[stops] = plan

    if not best_by_stops:
        if rules.require_compound_change and len(eligible) < 2:
            title = "A second dry compound is needed"
            summary = (
                f"{rules.label} rules require two different dry compounds, but only "
                f"{', '.join(eligible)} has enough clean laps to model. Upload data "
                "that includes another compound, or turn off the compound rule."
            )
        else:
            title = "No supported strategy covers this race distance"
            summary = (
                "The longest observed stints are too short to cover the race "
                "within the allowed number of stops without extrapolating "
                "beyond the data. Upload longer stints or allow more stops."
            )
        return {
            **base_payload,
            "verdict": {
                "code": "unsupported",
                "title": title,
                "summary": summary,
                "confidence": "n/a",
            },
            "recorded": None if recorded is None else plan_to_dict(
                recorded, model, rules, race_laps, None, pit_loss, fixed_total
            ),
            "recorded_reason": recorded_reason,
            "recommended": None,
            "alternatives": [],
            "gain": None,
            "explanation": [],
            "model": model_summary(model, rules, race_laps),
            "search": {"tyre_combinations": combos, "feasible_strategies": feasible},
            "assumptions": assumptions(model, pit_loss),
            "limitations": LIMITATIONS,
        }

    best = min(best_by_stops.values(), key=lambda p: p.total)

    sensitivity = None
    if (
        recorded is not None
        and sensitivity_model is not None
        and all(sensitivity_model.supports(c) for c, _ in recorded.stints + best.stints)
    ):
        alt_rec = build_plan(recorded.label, recorded.stints, sensitivity_model, pit_loss)
        alt_best = build_plan(best.label, best.stints, sensitivity_model, pit_loss)
        sensitivity = {
            "assumed_fuel_effect": round(-sensitivity_model.fuel_per_lap, 3),
            "gain_with_fuel_effect": round(alt_rec.total - alt_best.total, 3),
        }

    verdict, gain, explanation = _verdict(best, recorded, model, pit_loss, rules, sensitivity)

    if any(best.extrapolated):
        warnings.append(
            "The recommended plan runs at least one stint longer than you have "
            "recorded on that compound; wear beyond observed tyre age is extrapolated."
        )

    alternatives = [
        plan_to_dict(p, model, rules, race_laps, recorded, pit_loss, fixed_total)
        | {"is_recommended": p is best}
        for _, p in sorted(best_by_stops.items())
    ]

    return {
        **base_payload,
        "verdict": verdict,
        "recorded": None if recorded is None else plan_to_dict(
            recorded, model, rules, race_laps, None, pit_loss, fixed_total
        ),
        "recorded_reason": recorded_reason,
        "recommended": plan_to_dict(best, model, rules, race_laps, recorded, pit_loss, fixed_total),
        "alternatives": alternatives,
        "gain": gain,
        "explanation": explanation,
        "model": model_summary(model, rules, race_laps),
        "search": {"tyre_combinations": combos, "feasible_strategies": feasible},
        "assumptions": assumptions(model, pit_loss),
        "limitations": LIMITATIONS,
        "order_note": (
            "Stint order does not change the modelled time; the plan keeps your "
            "recorded starting tyre first where possible."
        ),
    }


def _verdict(
    best: Plan,
    recorded: Plan | None,
    model: PaceModel,
    pit_loss: PitLoss,
    rules: SimulatorRules,
    sensitivity: dict | None = None,
) -> tuple[dict, dict | None, list[str]]:
    explanation: list[str] = []
    used = sorted({c for c, _ in best.stints} | ({c for c, _ in recorded.stints} if recorded else set()))
    for c in used:
        fit = model.compounds[c]
        se = f" (±{fit.degradation_se:.3f})" if fit.degradation_se else ""
        if fit.degradation_constrained:
            explanation.append(f"{c}: no measurable tyre wear in your data; treated as 0.000 s/lap.")
        else:
            explanation.append(
                f"{c}: loses about {fit.degradation:.3f} s per lap of tyre age{se}, "
                f"from {fit.clean_laps} clean laps."
            )

    if recorded is None:
        return (
            {
                "code": "best_available",
                "title": f"Fastest modelled plan: {_stop_word(best.stops)}",
                "summary": (
                    "Your recorded strategy could not be re-simulated, so no time "
                    "saving is claimed. This is the fastest plan the data supports."
                ),
                "confidence": "n/a",
            },
            None,
            explanation,
        )

    gain = recorded.total - best.total
    statistical = difference_uncertainty(recorded, best, model, pit_loss)
    systematic = 0.0
    if sensitivity is not None:
        systematic = abs(gain - sensitivity["gain_with_fuel_effect"])
    sigma = sqrt(statistical**2 + systematic**2)
    probability = _normal_cdf(gain / sigma) if sigma > 0 else (1.0 if gain > 0 else 0.5)
    gain_info = {
        "seconds": round(gain, 3),
        "uncertainty_seconds": round(sigma, 3),
        "statistical_uncertainty": round(statistical, 3),
        "fuel_uncertainty": round(systematic, 3),
        "low": round(gain - 1.96 * sigma, 3),
        "high": round(gain + 1.96 * sigma, 3),
        "probability_faster": round(probability, 3),
        "fuel_sensitivity": sensitivity,
    }
    if sensitivity is not None and systematic >= 0.1:
        explanation.append(
            "Fuel burn could not be measured. If it is worth about "
            f"{sensitivity['assumed_fuel_effect']:.2f}s per lap, the predicted gain becomes "
            f"{sensitivity['gain_with_fuel_effect']:+.1f}s; that sensitivity is included "
            "in the uncertainty."
        )

    same = best.signature() == recorded.signature()
    if same or gain < MEANINGFUL_GAIN_SECONDS:
        verdict = {
            "code": "keep",
            "title": "Your recorded strategy is already the right call",
            "summary": (
                "No supported alternative is meaningfully faster "
                f"(best difference {_fmt(max(gain, 0.0))}). Keep this plan."
            ),
            "confidence": "high" if sigma < 2 else "moderate",
        }
        return verdict, gain_info, explanation

    change = (
        f"switching to a {_stop_word(best.stops)}"
        if best.stops != recorded.stops
        else "adjusting your pit timing"
    )

    tyre_delta = recorded.degradation_time - best.degradation_time
    pit_delta = best.pit_time - recorded.pit_time
    pace_delta = (recorded.racing_time - recorded.degradation_time) - (
        best.racing_time - best.degradation_time
    )
    parts = []
    if abs(tyre_delta) >= 0.1:
        parts.append(
            f"{'saves' if tyre_delta > 0 else 'adds'} {_fmt(abs(tyre_delta))} of tyre wear"
        )
    if abs(pace_delta) >= 0.1:
        parts.append(
            f"{'gains' if pace_delta > 0 else 'loses'} {_fmt(abs(pace_delta))} from compound base pace"
        )
    if abs(pit_delta) >= 0.1:
        parts.append(
            f"{'costs' if pit_delta > 0 else 'saves'} {_fmt(abs(pit_delta))} in pit lane time"
        )
    if parts:
        explanation.insert(0, "Compared with your race, the recommended plan " + ", ".join(parts) + ".")

    if gain < sigma:
        verdict = {
            "code": "inconclusive",
            "title": "Possible small gain, within model uncertainty",
            "summary": (
                f"The model finds {change} about {_fmt(gain)} faster, but the "
                f"uncertainty is ±{_fmt(sigma)}. Your recorded strategy remains a sound choice."
            ),
            "confidence": "low",
        }
    elif gain < 2 * sigma:
        verdict = {
            "code": "likely",
            "title": f"Consider {change}",
            "summary": (
                f"Estimated {_fmt(gain)} faster (±{_fmt(sigma)}). The evidence favours "
                "the change, but a second race of data would confirm it."
            ),
            "confidence": "moderate",
        }
    else:
        verdict = {
            "code": "recommended",
            "title": f"Faster strategy found: {change}",
            "summary": (
                f"Estimated {_fmt(gain)} faster (±{_fmt(sigma)}), well beyond the "
                "model's uncertainty."
            ),
            "confidence": "high",
        }
    return verdict, gain_info, explanation


def model_summary(model: PaceModel | None, rules: SimulatorRules, race_laps: int) -> dict | None:
    if model is None:
        return None
    return {
        "fuel_mode": model.fuel_mode,
        "fuel_per_lap": round(model.fuel_per_lap, 4),
        "residual_std": round(model.residual_std, 3),
        "clean_laps": model.n_obs,
        "compounds": [
            {
                "compound": c,
                "base_lap": round(fit.base, 3),
                "degradation_per_lap": round(fit.degradation, 4),
                "degradation_se": None if fit.degradation_se is None else round(fit.degradation_se, 4),
                "clean_laps": fit.clean_laps,
                "max_observed_age": fit.max_age,
                "max_stint_laps": stint_limit(model, c, rules, race_laps),
                "degradation_constrained": fit.degradation_constrained,
                "wet": c in WET_COMPOUNDS,
            }
            for c, fit in sorted(model.compounds.items())
        ],
        "excluded": [
            {"compound": c, "reason": reason} for c, reason in sorted(model.excluded.items())
        ],
    }


def assumptions(model: PaceModel | None, pit_loss: PitLoss) -> list[str]:
    items = [
        f"Pit loss: {pit_loss.seconds:.1f}s per stop ({pit_loss.source}). {pit_loss.note}",
        "Tyre wear is modelled as a constant lap-time loss per lap of tyre age.",
        "Every new stint starts on a fresh set of tyres.",
        f"Stints may run at most {int((EXTRAPOLATION_FACTOR - 1) * 100)}% longer than "
        "your longest recorded run on that compound.",
    ]
    if model is not None:
        if model.fuel_mode == "estimated":
            items.append(
                f"Fuel burn and track evolution measured at {model.fuel_per_lap:+.3f} s per lap."
            )
        elif model.fuel_mode == "assumed":
            items.append(
                f"Fuel effect assumed at {model.fuel_per_lap:+.3f} s per lap (user setting)."
            )
        else:
            items.append(
                "Fuel burn could not be separated from tyre wear in this data, so "
                "the wear figures include it. True wear is likely higher, which makes "
                "the advisor conservative about adding stops."
            )
    return items


LIMITATIONS = [
    "Traffic, undercuts, safety cars, weather changes and tyre warm-up are not modelled.",
    "Simulator tyre rules, refuelling and mandatory stops are only as accurate as the selected preset.",
    "Recommendations are estimates from one session's data, not guaranteed results.",
]
