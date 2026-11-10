"""Simulator-specific strategy constraints and default assumptions.

Rules differ per game and per championship setting, so every preset is
a *default*: the API lets users override each value. Default pit losses
are typical figures, not measurements, and are always labelled as
assumptions in API responses.
"""

from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(frozen=True)
class SimulatorRules:
    key: str
    label: str
    require_compound_change: bool
    default_pit_loss: float
    max_stops: int = 3
    min_stint_laps: int = 3
    note: str = ""


PRESETS: dict[str, SimulatorRules] = {
    "f1": SimulatorRules(
        key="f1",
        label="F1 Series",
        require_compound_change=True,
        default_pit_loss=22.0,
        note="Dry races require at least two different dry compounds.",
    ),
    "acc": SimulatorRules(
        key="acc",
        label="Assetto Corsa Competizione",
        require_compound_change=False,
        default_pit_loss=25.0,
        note="Mandatory pit windows and refuelling depend on the server settings.",
    ),
    "ac": SimulatorRules(
        key="ac",
        label="Assetto Corsa",
        require_compound_change=False,
        default_pit_loss=25.0,
    ),
    "iracing": SimulatorRules(
        key="iracing",
        label="iRacing",
        require_compound_change=False,
        default_pit_loss=25.0,
        note="Some series require tyre or fuel stops; check the series rules.",
    ),
    "lmu": SimulatorRules(
        key="lmu",
        label="Le Mans Ultimate",
        require_compound_change=False,
        default_pit_loss=30.0,
        note="Endurance stops often include refuelling and driver changes.",
    ),
    "generic": SimulatorRules(
        key="generic",
        label="Other / Custom",
        require_compound_change=False,
        default_pit_loss=25.0,
    ),
}

_ALIASES = {
    "f1": "f1", "f1 series": "f1", "formula 1": "f1", "f1 24": "f1", "f1 25": "f1",
    "acc": "acc", "assetto corsa competizione": "acc",
    "ac": "ac", "assetto corsa": "ac", "assetto corsa evo": "ac",
    "iracing": "iracing",
    "lmu": "lmu", "le mans ultimate": "lmu",
}


def resolve_rules(
    simulator: str | None,
    require_compound_change: bool | None = None,
    max_stops: int | None = None,
    min_stint_laps: int | None = None,
) -> SimulatorRules:
    key = _ALIASES.get((simulator or "").strip().lower(), "generic")
    rules = PRESETS[key]
    overrides = {}
    if require_compound_change is not None:
        overrides["require_compound_change"] = require_compound_change
    if max_stops is not None:
        overrides["max_stops"] = max_stops
    if min_stint_laps is not None:
        overrides["min_stint_laps"] = min_stint_laps
    return replace(rules, **overrides) if overrides else rules
