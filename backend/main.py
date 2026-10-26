
from io import BytesIO
from math import isfinite

import pandas as pd

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from strategy import router as strategy_router

app = FastAPI(
    title="Laplogic API",
    description="Universal racing performance and pit-stop analysis",
    version="0.3.0",
)
app.include_router(strategy_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

MAX_FILE_SIZE = 5 * 1024 * 1024


@app.get("/")
def home():
    return {
        "message": "Welcome to Laplogic",
        "tagline": "Race Smarter. Lap Faster.",
    }


@app.get("/api/health")
def health():
    return {
        "status": "running",
        "application": "Laplogic",
        "version": "0.3.0",
    }


# ==========================================
# TIME PARSING
# ==========================================

def parse_lap_time(value):
    """
    Supports:
    95.432
    1:35.432
    00:01:35.432
    """
    if pd.isna(value):
        raise ValueError("Missing lap time.")

    text = str(value).strip()
    parts = text.split(":")

    try:
        if len(parts) == 1:
            seconds = float(parts[0])

        elif len(parts) == 2:
            minutes = int(parts[0])
            remaining = float(parts[1])

            if minutes < 0 or not 0 <= remaining < 60:
                raise ValueError()

            seconds = minutes * 60 + remaining

        elif len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            remaining = float(parts[2])

            if (
                hours < 0
                or not 0 <= minutes < 60
                or not 0 <= remaining < 60
            ):
                raise ValueError()

            seconds = (
                hours * 3600
                + minutes * 60
                + remaining
            )

        else:
            raise ValueError()

    except (ValueError, TypeError):
        raise ValueError(
            f"Invalid time value: {text}"
        )

    if not isfinite(seconds) or seconds <= 0:
        raise ValueError(
            f"Invalid positive time value: {text}"
        )

    return seconds


# ==========================================
# PIT STOP FIELD PARSING
# ==========================================

def parse_pit_flag(value):
    if pd.isna(value) or str(value).strip() == "":
        return False

    text = str(value).strip().lower()

    if text in {"yes", "true", "1", "y"}:
        return True

    if text in {"no", "false", "0", "n"}:
        return False

    raise ValueError(
        f"Invalid pit_stop value: {value}. "
        "Use yes or no."
    )


def parse_optional_duration(value):
    if pd.isna(value) or str(value).strip() == "":
        return None

    return parse_lap_time(value)


# ==========================================
# CSV ANALYSIS ENDPOINT
# ==========================================

@app.post("/api/analyze/csv")
async def analyze_csv(file: UploadFile = File(...)):
    filename = file.filename or ""

    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a CSV file.",
        )

    try:
        contents = await file.read(MAX_FILE_SIZE + 1)

        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="File exceeds the 5 MB limit.",
            )

        if not contents:
            raise HTTPException(
                status_code=400,
                detail="Uploaded CSV is empty.",
            )

        try:
            df = pd.read_csv(BytesIO(contents))

        except (
            UnicodeError,
            pd.errors.ParserError,
            pd.errors.EmptyDataError,
        ):
            raise HTTPException(
                status_code=422,
                detail="Unable to read the CSV file.",
            )

        df.columns = (
            df.columns
            .str.strip()
            .str.lower()
            .str.replace(" ", "_")
        )

        if not {"lap", "lap_time"}.issubset(df.columns):
            raise HTTPException(
                status_code=422,
                detail=(
                    "CSV requires lap and lap_time columns."
                ),
            )

        if df.empty:
            raise HTTPException(
                status_code=422,
                detail="No lap records found.",
            )

        # ==================================
        # CIRCUIT IDENTIFICATION
        # ==================================

        circuit = "Not provided"

        circuit_column = next(
            (
                name
                for name in ["circuit", "track", "track_name"]
                if name in df.columns
            ),
            None,
        )

        if circuit_column:
            circuits = (
                df[circuit_column]
                .dropna()
                .astype(str)
                .str.strip()
            )

            circuits = circuits[
                circuits.ne("")
            ].unique().tolist()

            if len(circuits) > 1:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "CSV contains multiple circuits. "
                        "Upload one circuit session per file."
                    ),
                )

            if circuits:
                circuit = circuits[0]

        # ==================================
        # VALIDATE LAP DATA
        # ==================================

        df["lap"] = pd.to_numeric(
            df["lap"],
            errors="coerce",
        )

        if (
            df["lap"].isna().any()
            or (df["lap"] <= 0).any()
            or (df["lap"] % 1 != 0).any()
        ):
            raise HTTPException(
                status_code=422,
                detail="Lap numbers must be positive integers.",
            )

        if df["lap"].duplicated().any():
            raise HTTPException(
                status_code=422,
                detail="Duplicate lap numbers detected.",
            )

        try:
            df["lap_seconds"] = df["lap_time"].apply(
                parse_lap_time
            )

        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail=str(error),
            )

        df = (
            df.sort_values("lap")
            .reset_index(drop=True)
        )

        df["lap"] = df["lap"].astype(int)

        # ==================================
        # TYRE COMPOUNDS
        # ==================================

        if "compound" not in df.columns:
            df["compound"] = "UNKNOWN"

        df["compound"] = (
            df["compound"]
            .fillna("UNKNOWN")
            .astype(str)
            .str.strip()
            .str.upper()
            .replace("", "UNKNOWN")
        )

        # ==================================
        # PIT STOPS
        # ==================================

        has_pit_column = "pit_stop" in df.columns

        if has_pit_column:
            try:
                df["is_pit_stop"] = df["pit_stop"].apply(
                    parse_pit_flag
                )
            except ValueError as error:
                raise HTTPException(
                    status_code=422,
                    detail=str(error),
                )
        else:
            df["is_pit_stop"] = False

        if "pit_duration" in df.columns:
            try:
                df["pit_seconds"] = df[
                    "pit_duration"
                ].apply(parse_optional_duration)

            except ValueError as error:
                raise HTTPException(
                    status_code=422,
                    detail=str(error),
                )
        else:
            df["pit_seconds"] = None

        # Non-pit laps must not have pit durations.
        invalid_duration = (
            ~df["is_pit_stop"]
            & df["pit_seconds"].notna()
        )

        if invalid_duration.any():
            raise HTTPException(
                status_code=422,
                detail=(
                    "pit_duration was supplied on a lap "
                    "that is not marked as a pit stop."
                ),
            )

        # ==================================
        # LAP PERFORMANCE
        # ==================================

        fastest = float(df["lap_seconds"].min())
        slowest = float(df["lap_seconds"].max())
        average = float(df["lap_seconds"].mean())
        median = float(df["lap_seconds"].median())

        consistency = float(
            df["lap_seconds"].std(ddof=0)
        )

        best_index = df["lap_seconds"].idxmin()
        best_lap_number = int(
            df.loc[best_index, "lap"]
        )

        df["delta_to_best"] = (
            df["lap_seconds"] - fastest
        )

        df["delta_to_average"] = (
            df["lap_seconds"] - average
        )

        df["cumulative_time"] = (
            df["lap_seconds"].cumsum()
        )

        # ==================================
        # PIT STOP EVENTS
        # ==================================

        pit_stops = []

        pit_rows = df[df["is_pit_stop"]]

        for row in pit_rows.itertuples(index=False):
            duration = (
                float(row.pit_seconds)
                if pd.notna(row.pit_seconds)
                else None
            )

            pit_stops.append({
                "lap": int(row.lap),
                "compound_before": row.compound,
                "duration": (
                    round(duration, 3)
                    if duration is not None
                    else None
                ),
            })

        recorded_durations = [
            stop["duration"]
            for stop in pit_stops
            if stop["duration"] is not None
        ]

        total_pit_duration = (
            round(sum(recorded_durations), 3)
            if recorded_durations
            else None
        )

        # ==================================
        # TYRE STINTS
        # ==================================

        stints = []

        stint_start_index = 0

        for index, row in df.iterrows():
            is_last_row = index == len(df) - 1

            # A pit stop ends the current stint.
            # The next lap begins the next stint.
            if bool(row["is_pit_stop"]) or is_last_row:
                stint_data = df.iloc[
                    stint_start_index:index + 1
                ]

                compounds = (
                    stint_data["compound"]
                    .unique()
                    .tolist()
                )

                stint = {
                    "stint_number": len(stints) + 1,
                    "start_lap": int(
                        stint_data.iloc[0]["lap"]
                    ),
                    "end_lap": int(
                        stint_data.iloc[-1]["lap"]
                    ),
                    "recorded_laps": len(stint_data),
                    "compound": (
                        compounds[0]
                        if len(compounds) == 1
                        else "MIXED"
                    ),
                    "average_lap": round(
                        float(
                            stint_data["lap_seconds"].mean()
                        ),
                        3,
                    ),
                }

                stints.append(stint)
                stint_start_index = index + 1

        # ==================================
        # LAP-BY-LAP OUTPUT
        # ==================================

        laps = []

        for row in df.itertuples(index=False):
            laps.append({
                "lap": int(row.lap),
                "lap_time": round(
                    float(row.lap_seconds), 3
                ),
                "compound": row.compound,
                "is_pit_stop": bool(row.is_pit_stop),
                "pit_duration": (
                    round(float(row.pit_seconds), 3)
                    if pd.notna(row.pit_seconds)
                    else None
                ),
                "delta_to_best": round(
                    float(row.delta_to_best), 3
                ),
                "delta_to_average": round(
                    float(row.delta_to_average), 3
                ),
                "cumulative_time": round(
                    float(row.cumulative_time), 3
                ),
            })

        notes = [
            "Lap times and durations are expressed in seconds.",
            "A pit stop is recorded only when explicitly marked in the CSV.",
            "A tyre compound change alone does not confirm a pit stop.",
            "Pit duration is reported separately and may already be included in lap time.",
            "Pit duration definitions vary by simulator.",
            "No pit penalties are added to lap totals.",
            "All recorded laps are included in overall pace statistics.",
            "Strategy optimization is not yet implemented.",
        ]

        if not has_pit_column:
            notes.append(
                "No pit_stop column was supplied. "
                "Pit-stop detection is unavailable."
            )

        if circuit == "Not provided":
            notes.append(
                "No circuit metadata was supplied in the CSV."
            )

        return {
            "status": "success",
            "filename": filename,
            "analysis_type": "race_performance",
            "circuit": circuit,
            "total_laps": len(df),

            "statistics": {
                "fastest_lap": round(fastest, 3),
                "slowest_lap": round(slowest, 3),
                "average_lap": round(average, 3),
                "median_lap": round(median, 3),
                "consistency_std": round(consistency, 3),
                "best_lap_number": best_lap_number,
                "total_recorded_time": round(
                    float(df["lap_seconds"].sum()), 3
                ),
            },

            "pit_analysis": {
                "available": has_pit_column,
                "total_pit_stops": len(pit_stops),
                "stops": pit_stops,
                "recorded_duration_count": len(
                    recorded_durations
                ),
                "total_recorded_pit_duration":
                    total_pit_duration,
                "duration_is_additional_to_lap_time":
                    False,
            },

            "stints": stints,
            "laps": laps,
            "notes": notes,
        }

    finally:
        await file.close()
