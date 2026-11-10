"""Deterministic tyre pace model.

For every clean lap ``i`` the model assumes

    lap_time_i = base[c] + degradation[c] * tyre_age_i + fuel * lap_i + noise

* ``base[c]``        pace of a fresh set of compound ``c``
* ``degradation[c]`` seconds lost per lap of tyre age (constrained >= 0)
* ``fuel``           lap-time change per race lap from fuel burn and track
                     evolution; shared by all compounds

The fuel term is only *estimated* when the data can separate it from
tyre age (the same compound must be run in more than one stint). Otherwise
it is either supplied by the user or omitted, and the limitation is
reported, because then tyre degradation and fuel burn-off are confounded.

The model is fitted by ordinary least squares, which also gives a
parameter covariance matrix used to quantify strategy uncertainty.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

MIN_CLEAN_LAPS = 4
MIN_DISTINCT_AGES = 3
MAX_ABS_FUEL_EFFECT = 0.3  # s/lap; larger values are not physically plausible


@dataclass
class CompoundFit:
    compound: str
    base: float
    degradation: float
    degradation_se: float | None
    clean_laps: int
    max_age: int
    stints: int
    degradation_constrained: bool  # fitted slope was negative, fixed at 0


@dataclass
class PaceModel:
    params: list[tuple[str, str]]
    beta: np.ndarray
    cov: np.ndarray
    residual_std: float
    n_obs: int
    fuel_mode: str  # "estimated" | "assumed" | "none"
    fuel_per_lap: float
    compounds: dict[str, CompoundFit]
    excluded: dict[str, str] = field(default_factory=dict)

    def _index(self, kind: str, compound: str = "") -> int | None:
        try:
            return self.params.index((kind, compound))
        except ValueError:
            return None

    def supports(self, compound: str) -> bool:
        return compound in self.compounds

    def predict_lap(self, compound: str, age: int, lap: int) -> float:
        fit = self.compounds[compound]
        return fit.base + fit.degradation * age + self.fuel_per_lap * lap

    def stint_vector(self, compound: str, length: int) -> np.ndarray:
        """Gradient of a stint's summed lap time w.r.t. the parameters.

        Excludes the fuel term, which is identical for every strategy of
        the same race length.
        """
        vec = np.zeros(len(self.params))
        b = self._index("base", compound)
        d = self._index("deg", compound)
        if b is not None:
            vec[b] = length
        if d is not None:
            vec[d] = length * (length + 1) / 2
        return vec

    def stint_time(self, compound: str, length: int) -> float:
        fit = self.compounds[compound]
        return length * fit.base + fit.degradation * length * (length + 1) / 2

    def stint_degradation_time(self, compound: str, length: int) -> float:
        return self.compounds[compound].degradation * length * (length + 1) / 2

    def stint_display_time(self, compound: str, start_lap: int, length: int) -> float:
        """Stint time including its share of the fuel term (for display)."""
        laps_sum = length * (2 * start_lap + length - 1) / 2
        return self.stint_time(compound, length) + self.fuel_per_lap * laps_sum

    def fuel_total(self, race_laps: int) -> float:
        return self.fuel_per_lap * race_laps * (race_laps + 1) / 2


def _design(
    data: pd.DataFrame,
    compounds: list[str],
    no_deg: set[str],
    with_fuel: bool,
) -> tuple[np.ndarray, list[tuple[str, str]]]:
    columns, params = [], []
    for c in compounds:
        mask = (data["compound"] == c).to_numpy(dtype=float)
        columns.append(mask)
        params.append(("base", c))
        if c not in no_deg:
            columns.append(mask * data["tyre_age"].to_numpy(dtype=float))
            params.append(("deg", c))
    if with_fuel:
        columns.append(data["lap"].to_numpy(dtype=float))
        params.append(("fuel", ""))
    return np.column_stack(columns), params


def fit_pace_model(
    laps: pd.DataFrame,
    fuel_effect: float | None = None,
) -> PaceModel | None:
    """Fit the pace model to classified laps.

    ``fuel_effect`` (seconds gained per lap as fuel burns, e.g. 0.05) is an
    optional user assumption used when the data cannot estimate it.
    Returns ``None`` when no compound has enough clean data.
    """
    clean = laps[laps["is_clean"]]
    excluded: dict[str, str] = {}
    eligible: list[str] = []

    for compound, group in clean.groupby("compound", sort=True):
        if len(group) < MIN_CLEAN_LAPS:
            excluded[compound] = (
                f"Only {len(group)} clean lap(s); at least {MIN_CLEAN_LAPS} are needed."
            )
        elif group["tyre_age"].nunique() < MIN_DISTINCT_AGES:
            excluded[compound] = "Not enough tyre-age variation to measure wear."
        else:
            eligible.append(compound)

    for compound in laps["compound"].unique():
        if compound not in eligible and compound not in excluded:
            excluded[compound] = "No clean laps available."

    if not eligible:
        return None

    data = clean[clean["compound"].isin(eligible)]
    y = data["lap_seconds"].to_numpy(dtype=float)

    fuel_mode = "none"
    fixed_fuel = 0.0
    if fuel_effect is not None and fuel_effect != 0:
        fuel_mode = "assumed"
        fixed_fuel = -abs(fuel_effect)
        y = y - fixed_fuel * data["lap"].to_numpy(dtype=float)

    def solve(no_deg: set[str], with_fuel: bool):
        X, params = _design(data, eligible, no_deg, with_fuel)
        if X.shape[0] - X.shape[1] < 2:
            return None
        if np.linalg.matrix_rank(X) < X.shape[1]:
            return None
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        return X, params, beta

    try_fuel = fuel_mode == "none"
    no_deg: set[str] = set()
    result = None

    for _ in range(len(eligible) + 2):
        result = solve(no_deg, try_fuel)
        if result is None and try_fuel:
            try_fuel = False
            continue
        if result is None:
            return None

        X, params, beta = result
        if try_fuel:
            fuel = beta[params.index(("fuel", ""))]
            # A slower-over-time trend would absorb tyre wear into the shared
            # term and understate degradation, so it is not accepted.
            if fuel > 0 or abs(fuel) > MAX_ABS_FUEL_EFFECT:
                try_fuel = False
                continue

        negative = {
            c for (kind, c), value in zip(params, beta)
            if kind == "deg" and value < 0
        }
        if not negative:
            break
        no_deg |= negative

    assert result is not None
    X, params, beta = result
    residuals = y - X @ beta
    dof = X.shape[0] - X.shape[1]
    sigma2 = float(residuals @ residuals) / dof
    cov = sigma2 * np.linalg.pinv(X.T @ X)

    if try_fuel:
        fuel_mode = "estimated"
        fuel_per_lap = float(beta[params.index(("fuel", ""))])
    else:
        fuel_per_lap = fixed_fuel

    def value(kind: str, c: str) -> tuple[float, float | None]:
        if (kind, c) not in params:
            return 0.0, None
        i = params.index((kind, c))
        return float(beta[i]), float(np.sqrt(max(cov[i, i], 0.0)))

    compounds: dict[str, CompoundFit] = {}
    for c in eligible:
        group = data[data["compound"] == c]
        deg, deg_se = value("deg", c)
        compounds[c] = CompoundFit(
            compound=c,
            base=value("base", c)[0],
            degradation=deg,
            degradation_se=deg_se,
            clean_laps=int(len(group)),
            max_age=int(laps.loc[laps["compound"] == c, "tyre_age"].max()),
            stints=int(group["stint"].nunique()),
            degradation_constrained=c in no_deg,
        )

    return PaceModel(
        params=params,
        beta=beta,
        cov=cov,
        residual_std=float(np.sqrt(sigma2)),
        n_obs=int(X.shape[0]),
        fuel_mode=fuel_mode,
        fuel_per_lap=fuel_per_lap,
        compounds=compounds,
        excluded=excluded,
    )
