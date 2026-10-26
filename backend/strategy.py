
from io import BytesIO
from math import isfinite

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from typing import Literal

router = APIRouter(prefix="/api/strategy", tags=["Race Strategy"])

MAX_FILE_SIZE = 5 * 1024 * 1024

Compound = Literal["SOFT", "MEDIUM", "HARD"]
StrategyType = Literal["one_stop", "two_stop"]


def parse_time(value):
    """Convert seconds, M:SS or H:MM:SS to seconds."""
    if pd.isna(value):
        raise ValueError("Missing lap time")

    parts = str(value).strip().split(":")

    try:
        if len(parts) == 1:
            seconds = float(parts[0])
        elif len(parts) == 2:
            seconds = int(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 3:
            seconds = (
                int(parts[0]) * 3600
                + int(parts[1]) * 60
                + float(parts[2])
            )
        else:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError(f"Invalid time: {value}")

    if not isfinite(seconds) or seconds <= 0:
        raise ValueError(f"Invalid time: {value}")

    return seconds


def parse_pit(value):
    if pd.isna(value) or str(value).strip() == "":
        return False

    value = str(value).strip().lower()

    if value in {"yes", "true", "1", "y"}:
        return True
    if value in {"no", "false", "0", "n"}:
        return False

    raise ValueError(f"Invalid pit_stop value: {value}")


def load_race_data(contents):
    try:
        df = pd.read_csv(BytesIO(contents))
    except Exception:
        raise HTTPException(
            status_code=422,
            detail="Unable to read the CSV file."
        )

    df.columns = [
        str(column).strip().lower().replace(" ", "_")
        for column in df.columns
    ]

    required = {"lap", "lap_time", "compound"}
    missing = required - set(df.columns)

    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing columns: {', '.join(sorted(missing))}"
        )

    if df.empty:
        raise HTTPException(
            status_code=422,
            detail="CSV contains no laps."
        )

    try:
        df["lap"] = pd.to_numeric(df["lap"], errors="coerce")
        df["seconds"] = df["lap_time"].apply(parse_time)

        if "pit_stop" in df.columns:
            df["pit"] = df["pit_stop"].apply(parse_pit)
        else:
            df["pit"] = False

    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    if (
        df["lap"].isna().any()
        or (df["lap"] <= 0).any()
        or (df["lap"] % 1 != 0).any()
        or df["lap"].duplicated().any()
    ):
        raise HTTPException(
            status_code=422,
            detail="Lap numbers must be unique positive integers."
        )

    df["compound"] = (
        df["compound"].fillna("UNKNOWN")
        .astype(str).str.strip().str.upper()
    )

    df = df.sort_values("lap").reset_index(drop=True)

    # Each stint starts immediately after a recorded pit stop.
    # Compound changes without pit flags are not treated
    # as proof of a new stint.
    stint = 1
    ages = []
    age = 0

    for row in df.itertuples():
        age += 1
        ages.append(age)

        if row.pit:
            stint += 1
            age = 0

    df["stint_age"] = ages

    return df


def build_pace_profiles(df):
    # Exclude explicitly marked pit laps so pit delays
    # do not distort the normal driving-pace estimate.
    clean = df[~df["pit"]].copy()

    profiles = {}

    for compound, group in clean.groupby("compound"):
        if compound not in {"SOFT", "MEDIUM", "HARD"}:
            continue

        if len(group) < 2:
            continue

        profiles[compound] = {
            "average_lap": float(group["seconds"].mean()),
            "sample_laps": len(group),
            "max_observed_age": int(group["stint_age"].max()),
            "min_observed_age": int(group["stint_age"].min()),
        }

    return profiles


def build_stints(
    strategy_type,
    race_laps,
    first_pit_lap,
    second_pit_lap,
    first_compound,
    second_compound,
    third_compound,
):
    if not 2 <= first_pit_lap <= race_laps - 2:
        raise HTTPException(
            status_code=422,
            detail="First pit lap is outside the race window."
        )

    stints = [
        (1, first_pit_lap, first_compound)
    ]

    if strategy_type == "one_stop":
        stints.append((
            first_pit_lap + 1,
            race_laps,
            second_compound
        ))
    else:
        if second_pit_lap is None:
            raise HTTPException(
                status_code=422,
                detail="Two-stop strategy needs second_pit_lap."
            )

        if not first_pit_lap + 2 <= second_pit_lap <= race_laps - 2:
            raise HTTPException(
                status_code=422,
                detail="Second pit lap is invalid."
            )

        stints.extend([
            (
                first_pit_lap + 1,
                second_pit_lap,
                second_compound
            ),
            (
                second_pit_lap + 1,
                race_laps,
                third_compound
            ),
        ])

    return stints


def evaluate_strategy(name, stints, profiles, pit_loss):
    warnings = []
    breakdown = []
    racing_time = 0.0

    for start, end, compound in stints:
        length = end - start + 1
        profile = profiles.get(compound)

        if profile is None:
            return {
                "strategy": name,
                "supported": False,
                "reason": (
                    f"Insufficient clean {compound} lap data. "
                    "At least two recorded non-pit laps are needed."
                ),
            }

        # Simple conservative extrapolation guard.
        # Reject strategies more than twice the longest
        # observed clean stint age for that compound.
        if length > profile["max_observed_age"] * 2:
            return {
                "strategy": name,
                "supported": False,
                "reason": (
                    f"{compound} stint of {length} laps exceeds "
                    "the available pace-data extrapolation limit."
                ),
            }

        if length > profile["max_observed_age"]:
            warnings.append(
                f"{compound} stint extends beyond observed tyre age."
            )

        estimated = length * profile["average_lap"]
        racing_time += estimated

        breakdown.append({
            "start_lap": start,
            "end_lap": end,
            "compound": compound,
            "laps": length,
            "estimated_time": round(estimated, 3),
            "estimated_average_lap": round(
                profile["average_lap"], 3
            ),
        })

    stops = len(stints) - 1
    penalty = stops * pit_loss

    return {
        "strategy": name,
        "supported": True,
        "pit_stops": stops,
        "stints": breakdown,
        "estimated_racing_time": round(racing_time, 3),
        "pit_loss_total": round(penalty, 3),
        "estimated_total_time": round(
            racing_time + penalty, 3
        ),
        "warnings": warnings,
    }


@router.post("/compare")
async def compare_strategies(
    file: UploadFile = File(...),
    race_laps: int = Form(..., ge=5, le=500),
    strategy_type: StrategyType = Form("one_stop"),
    first_pit_lap: int = Form(...),
    second_pit_lap: int | None = Form(None),
    first_compound: Compound = Form("MEDIUM"),
    second_compound: Compound = Form("HARD"),
    third_compound: Compound = Form("SOFT"),
    pit_loss: float = Form(25.0, ge=0, le=300),
):
    try:
        if not (file.filename or "").lower().endswith(".csv"):
            raise HTTPException(
                status_code=400,
                detail="Upload a CSV file."
            )

        contents = await file.read(MAX_FILE_SIZE + 1)

        if not contents or len(contents) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="CSV must be between 1 byte and 5 MB."
            )

        df = load_race_data(contents)

        # The upload is one race/session.
        # Avoid using a short test session to predict
        # an arbitrarily long race.
        observed_laps = int(df["lap"].max())

        if race_laps > observed_laps * 2:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Requested race is more than twice the "
                    "observed session length. Upload longer "
                    "stint data before forecasting this race."
                ),
            )

        profiles = build_pace_profiles(df)

        custom_stints = build_stints(
            strategy_type,
            race_laps,
            first_pit_lap,
            second_pit_lap,
            first_compound,
            second_compound,
            third_compound,
        )

        # Compare with a simple alternative having a
        # different number of stops.
        if strategy_type == "one_stop":
            alt_first = max(2, race_laps // 3)
            alt_second = max(alt_first + 2, 2 * race_laps // 3)

            alternative = build_stints(
                "two_stop",
                race_laps,
                alt_first,
                alt_second,
                first_compound,
                second_compound,
                third_compound,
            )
        else:
            alternative = build_stints(
                "one_stop",
                race_laps,
                first_pit_lap,
                None,
                first_compound,
                second_compound,
                third_compound,
            )

        results = [
            evaluate_strategy(
                "Your Strategy",
                custom_stints,
                profiles,
                pit_loss,
            ),
            evaluate_strategy(
                "Alternative Strategy",
                alternative,
                profiles,
                pit_loss,
            ),
        ]

        supported = [
            result for result in results
            if result["supported"]
        ]

        supported.sort(
            key=lambda result: result["estimated_total_time"]
        )

        for rank, result in enumerate(supported, 1):
            result["rank"] = rank

        return {
            "status": "success",
            "race_laps": race_laps,
            "observed_laps": len(df),
            "pit_loss_assumption": pit_loss,
            "pace_profiles": {
                compound: {
                    "average_lap": round(
                        profile["average_lap"], 3
                    ),
                    "sample_laps": profile["sample_laps"],
                    "max_observed_age":
                        profile["max_observed_age"],
                }
                for compound, profile in profiles.items()
            },
            "strategies": results,
            "recommended": (
                supported[0]["strategy"]
                if supported else None
            ),
            "experimental": True,
            "method": (
                "Observed clean mean lap pace per compound, "
                "multiplied by planned stint lengths, plus "
                "assumed incremental pit losses."
            ),
            "limitations": [
                "This is a baseline scenario comparison, not ML.",
                "Tyre degradation, fuel load, traffic and weather are not modeled.",
                "Pit loss must be incremental to clean driving time.",
                "Results depend strongly on recorded compound samples.",
                "An unsupported strategy is not ranked.",
                "A lower projected time does not prove real-race superiority.",
            ],
        }

    finally:
        await file.close()
