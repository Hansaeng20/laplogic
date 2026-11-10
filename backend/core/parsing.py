"""CSV ingestion: column detection, value parsing and validation.

Simulator exports differ in column names, time formats and units. This
module maps common variants onto one canonical lap table so the rest of
Laplogic never has to care where the data came from.

Canonical columns produced by :func:`load_session`:

    lap           int     lap number (sorted, unique)
    lap_seconds   float   lap time in seconds
    compound      str     normalized tyre compound label
    is_pit_stop   bool    lap ends with a pit stop (in-lap)
    pit_seconds   float?  recorded pit duration, if supplied
    valid         bool    lap not invalidated by the simulator
    stint         int     1-based stint number
    tyre_age      int     laps on the current set, starting at 1
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from math import isfinite

import numpy as np
import pandas as pd

from .errors import DataError

MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # stays under Vercel's 4.5 MB body limit
MAX_ROWS = 20_000
MIN_LAPS = 3

# ------------------------------------------------------------------
# Column aliases (normalized names, highest priority first)
# ------------------------------------------------------------------

COLUMN_ALIASES: dict[str, list[str]] = {
    "lap": [
        "lap", "lap_number", "lapnumber", "lap_no", "lap_num", "lap_index",
        "lap_count", "laps", "lap_nr", "lap_id",
    ],
    "lap_time": [
        "lap_time", "laptime", "lap_time_s", "lap_time_sec", "lap_time_secs",
        "lap_time_seconds", "lap_seconds", "laptime_s", "laptime_seconds",
        "lap_time_ms", "laptime_ms", "lap_time_milliseconds", "lap_duration",
        "last_lap_time", "time", "lap_time_str",
    ],
    "compound": [
        "compound", "tyre", "tire", "tyre_compound", "tire_compound", "tyres",
        "tires", "visual_compound", "visual_tyre_compound", "actual_compound",
        "actual_tyre_compound", "tyre_type", "tire_type", "tyre_set",
    ],
    "pit_stop": [
        "pit_stop", "pitstop", "pit", "pitted", "is_pit", "is_pit_stop",
        "pit_lap", "in_pit", "pit_in", "in_lap", "box", "pit_flag",
    ],
    "pit_duration": [
        "pit_duration", "pit_time", "pit_stop_time", "pit_stop_duration",
        "pit_lane_time", "pitlane_time", "stationary_time", "pit_duration_s",
        "pit_seconds",
    ],
    "circuit": ["circuit", "track", "track_name", "circuit_name", "venue"],
    "driver": ["driver", "driver_name", "drivername", "player", "racer"],
    "valid": ["valid", "is_valid", "lap_valid", "valid_lap"],
    "invalid": [
        "invalid", "is_invalid", "lap_invalid", "invalidated",
        "lap_invalidated", "track_limits",
    ],
    "stint": ["stint", "stint_number", "stint_no", "stint_id"],
    "tyre_age": [
        "tyre_age", "tire_age", "tyre_age_laps", "tire_age_laps",
        "tyre_laps", "tire_laps", "tyres_age_laps",
    ],
}

# Labels that describe the same tyre. Unknown labels are kept as-is, so
# ACC "DRY", F1 "C3" or iRacing/LMU custom names still work.
COMPOUND_SYNONYMS: dict[str, str] = {
    "S": "SOFT", "SOFTS": "SOFT", "SUPERSOFT": "SUPERSOFT",
    "M": "MEDIUM", "MEDIUMS": "MEDIUM", "MED": "MEDIUM",
    "H": "HARD", "HARDS": "HARD",
    "I": "INTERMEDIATE", "INTER": "INTERMEDIATE", "INTERS": "INTERMEDIATE",
    "INTERMEDIATES": "INTERMEDIATE",
    "W": "WET", "WETS": "WET", "FULL_WET": "WET", "FULL WET": "WET",
    "RAIN": "WET", "WET_WEATHER": "WET",
    "": "UNKNOWN", "NAN": "UNKNOWN", "NONE": "UNKNOWN", "-": "UNKNOWN",
}

WET_COMPOUNDS = {"INTERMEDIATE", "WET"}

TRUE_VALUES = {"yes", "y", "true", "t", "1", "pit", "box", "in", "inlap", "x"}
FALSE_VALUES = {"no", "n", "false", "f", "0", "", "-", "none", "nan", "out"}


# ------------------------------------------------------------------
# Data structures
# ------------------------------------------------------------------

@dataclass
class Session:
    df: pd.DataFrame
    circuit: str
    columns: dict[str, str]  # canonical name -> original header
    pit_source: str | None   # column | stint_column | tyre_age | compound_change
    lap_time_unit: str
    warnings: list[str] = field(default_factory=list)
    dropped_rows: int = 0

    @property
    def race_laps(self) -> int:
        return int(self.df["lap"].max())


# ------------------------------------------------------------------
# Value parsing
# ------------------------------------------------------------------

_DOTTED_TIME = re.compile(r"^(\d+)\.(\d{1,2})\.(\d+)$")  # 1.23.456


def parse_time(value) -> float:
    """Convert a time value to seconds.

    Supports ``95.432``, ``1:35.432``, ``01:35.432``, ``0:01:35.432``,
    ``1.35.432`` (dot-separated minutes) and ``95,432`` (decimal comma).
    """
    if value is None or (isinstance(value, float) and not isfinite(value)):
        raise ValueError("missing time")

    if isinstance(value, (int, float, np.integer, np.floating)):
        seconds = float(value)
    else:
        text = str(value).strip()
        if not text:
            raise ValueError("missing time")

        if "," in text and "." not in text:
            text = text.replace(",", ".")

        dotted = _DOTTED_TIME.match(text)
        if dotted:
            text = f"{dotted.group(1)}:{dotted.group(2)}.{dotted.group(3)}"

        parts = text.split(":")
        try:
            if len(parts) == 1:
                seconds = float(parts[0])
            elif len(parts) == 2:
                minutes, rest = int(parts[0]), float(parts[1])
                if minutes < 0 or not 0 <= rest < 60:
                    raise ValueError
                seconds = minutes * 60 + rest
            elif len(parts) == 3:
                hours, minutes, rest = (
                    int(parts[0]), int(parts[1]), float(parts[2])
                )
                if hours < 0 or not 0 <= minutes < 60 or not 0 <= rest < 60:
                    raise ValueError
                seconds = hours * 3600 + minutes * 60 + rest
            else:
                raise ValueError
        except (TypeError, ValueError):
            raise ValueError(f"invalid time '{text}'") from None

    if not isfinite(seconds) or seconds <= 0:
        raise ValueError(f"invalid time '{value}'")

    return seconds


def parse_flag(value, column: str) -> bool:
    if value is None or (isinstance(value, float) and not isfinite(value)):
        return False
    text = str(value).strip().lower()
    if text in TRUE_VALUES:
        return True
    if text in FALSE_VALUES:
        return False
    raise DataError(
        f"Unrecognized value '{value}' in column '{column}'. "
        "Use yes/no, true/false or 1/0."
    )


def normalize_compound(value) -> str:
    if value is None or (isinstance(value, float) and not isfinite(value)):
        return "UNKNOWN"
    text = re.sub(r"\s+", " ", str(value).strip().upper())
    return COMPOUND_SYNONYMS.get(text, text) or "UNKNOWN"


def normalize_header(name) -> str:
    text = re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower())
    return text.strip("_")


# ------------------------------------------------------------------
# CSV reading
# ------------------------------------------------------------------

def decode_csv_bytes(contents: bytes) -> str:
    if not contents:
        raise DataError("The uploaded CSV is empty.", status_code=400)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise DataError("The file exceeds the 4 MB upload limit.", status_code=413)
    if b"\x00" in contents[:4096]:
        raise DataError(
            "The file looks binary. Export your session as a plain-text CSV.",
            status_code=400,
        )
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return contents.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DataError("Unable to decode the CSV text encoding.")  # pragma: no cover


def read_csv_text(text: str) -> pd.DataFrame:
    sample = "\n".join(
        line for line in text.splitlines()[:20] if line.strip()
    )
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","

    try:
        df = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            dtype=str,
            keep_default_na=False,
            skip_blank_lines=True,
            nrows=MAX_ROWS + 1,
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, ValueError):
        raise DataError(
            "Unable to read the CSV file. Check that it is comma, "
            "semicolon or tab separated with a single header row."
        ) from None

    if len(df) > MAX_ROWS:
        raise DataError(f"CSV exceeds the {MAX_ROWS:,}-row limit.")

    # Treat whitespace-only cells as missing.
    df = df.apply(lambda col: col.str.strip()).replace("", np.nan)
    return df.dropna(how="all")


def detect_columns(df: pd.DataFrame) -> dict[str, str]:
    """Map canonical names to the original headers present in ``df``."""
    normalized: dict[str, str] = {}
    for original in df.columns:
        key = normalize_header(original)
        normalized.setdefault(key, original)

    found: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalized and normalized[alias] not in found.values():
                found[canonical] = normalized[alias]
                break
    return found


# ------------------------------------------------------------------
# Session loading
# ------------------------------------------------------------------

def _single_value(df: pd.DataFrame, column: str | None, label: str) -> str | None:
    if column is None:
        return None
    values = df[column].dropna().astype(str).str.strip()
    unique = [v for v in values.unique().tolist() if v]
    if len(unique) > 1:
        raise DataError(
            f"CSV contains multiple {label}s ({', '.join(unique[:3])}). "
            f"Upload one {label} per file."
        )
    return unique[0] if unique else None


def _lap_time_is_ms(header: str, values: pd.Series) -> bool:
    key = normalize_header(header)
    if key.endswith("_ms") or "milli" in key:
        return True
    numeric = pd.to_numeric(values, errors="coerce").dropna()
    # No real lap takes 1,000 s; integer values that large are milliseconds.
    return len(numeric) > 0 and float(numeric.median()) > 1000


def load_session(contents: bytes) -> Session:
    """Parse uploaded CSV bytes into a validated :class:`Session`."""
    raw = read_csv_text(decode_csv_bytes(contents))
    columns = detect_columns(raw)
    warnings: list[str] = []

    if "lap_time" not in columns:
        raise DataError(
            "Could not find a lap-time column. Expected a header such as "
            "'lap_time', 'LapTime' or 'Lap Time (s)'."
        )
    if raw.empty:
        raise DataError("No lap records found.")

    circuit = _single_value(raw, columns.get("circuit"), "circuit") or "Not provided"
    _single_value(raw, columns.get("driver"), "driver")

    df = pd.DataFrame(index=raw.index)

    # Lap numbers ------------------------------------------------------
    if "lap" in columns:
        laps = pd.to_numeric(raw[columns["lap"]], errors="coerce")
    else:
        laps = pd.Series(np.arange(1, len(raw) + 1), index=raw.index, dtype=float)
        warnings.append("No lap-number column found; laps were numbered in file order.")

    # Lap times --------------------------------------------------------
    time_header = columns["lap_time"]
    is_ms = _lap_time_is_ms(time_header, raw[time_header])

    def _parse(value):
        try:
            seconds = parse_time(value)
        except ValueError:
            return np.nan
        return seconds / 1000 if is_ms else seconds

    df["lap"] = laps
    df["lap_seconds"] = raw[time_header].map(
        lambda v: np.nan if pd.isna(v) else _parse(v)
    )

    bad_rows = df["lap"].isna() | df["lap_seconds"].isna()
    dropped = int(bad_rows.sum())
    if dropped:
        warnings.append(
            f"{dropped} row(s) without a usable lap number or lap time were skipped."
        )
    if dropped > len(df) / 2:
        raise DataError(
            "Most rows have missing or invalid lap times. "
            "Check the lap-time column format (e.g. 95.432 or 1:35.432)."
        )

    keep = ~bad_rows
    df = df[keep]
    raw = raw[keep]

    if ((df["lap"] <= 0) | (df["lap"] % 1 != 0)).any():
        raise DataError("Lap numbers must be positive integers.")
    df["lap"] = df["lap"].astype(int)

    if df["lap"].duplicated().any():
        dupes = sorted(df.loc[df["lap"].duplicated(), "lap"].unique().tolist())[:5]
        raise DataError(
            f"Duplicate lap numbers detected ({', '.join(map(str, dupes))}). "
            "Upload a single driver's race session per file."
        )

    if len(df) < MIN_LAPS:
        raise DataError(f"At least {MIN_LAPS} valid laps are required for analysis.")

    # Optional columns ---------------------------------------------------
    df["compound"] = (
        raw[columns["compound"]].map(normalize_compound)
        if "compound" in columns
        else "UNKNOWN"
    )
    if "compound" not in columns:
        warnings.append("No tyre-compound column found; tyre analysis is limited.")

    if "valid" in columns:
        df["valid"] = raw[columns["valid"]].map(
            lambda v: True if pd.isna(v) else parse_flag(v, columns["valid"])
        )
    elif "invalid" in columns:
        df["valid"] = ~raw[columns["invalid"]].map(
            lambda v: parse_flag(v, columns["invalid"])
        )
    else:
        df["valid"] = True
    df["valid"] = df["valid"].astype(bool)

    if "pit_duration" in columns:
        def _duration(value):
            if pd.isna(value):
                return np.nan
            try:
                seconds = parse_time(value)
            except ValueError:
                raise DataError(
                    f"Invalid pit duration '{value}'. Use seconds or M:SS.mmm."
                ) from None
            return seconds

        df["pit_seconds"] = raw[columns["pit_duration"]].map(_duration).astype(float)
    else:
        df["pit_seconds"] = np.nan

    # Keep any extra lookups aligned before sorting.
    stint_values = (
        pd.to_numeric(raw[columns["stint"]], errors="coerce")
        if "stint" in columns else None
    )
    age_values = (
        pd.to_numeric(raw[columns["tyre_age"]], errors="coerce")
        if "tyre_age" in columns else None
    )
    pit_values = (
        raw[columns["pit_stop"]].map(lambda v: parse_flag(v, columns["pit_stop"]))
        if "pit_stop" in columns else None
    )

    order = df["lap"].sort_values(kind="stable").index
    df = df.loc[order].reset_index(drop=True)

    # Pit-stop detection --------------------------------------------------
    pit_source: str | None
    if pit_values is not None:
        df["is_pit_stop"] = pit_values.loc[order].to_numpy(dtype=bool)
        pit_source = "column"
    elif stint_values is not None and stint_values.notna().all():
        s = stint_values.loc[order].to_numpy()
        df["is_pit_stop"] = np.append(s[1:] != s[:-1], False)
        pit_source = "stint_column"
    elif age_values is not None and age_values.notna().all():
        a = age_values.loc[order].to_numpy()
        df["is_pit_stop"] = np.append(a[1:] < a[:-1], False)
        pit_source = "tyre_age"
    elif "compound" in columns:
        c = df["compound"].to_numpy()
        df["is_pit_stop"] = np.append(c[1:] != c[:-1], False)
        pit_source = "compound_change" if df["is_pit_stop"].any() else None
        if pit_source:
            warnings.append(
                "No pit-stop column found. Pit stops were inferred from tyre "
                "compound changes; add a pit_stop column for exact detection."
            )
    else:
        df["is_pit_stop"] = False
        pit_source = None

    df["is_pit_stop"] = df["is_pit_stop"].astype(bool)

    if pit_source is None and "pit_stop" not in columns:
        warnings.append("No pit-stop information found; the session is treated as one stint.")

    last = len(df) - 1
    if df.at[last, "is_pit_stop"]:
        warnings.append("The final lap is marked as a pit stop; it is treated as the race end.")
        df.at[last, "is_pit_stop"] = False

    stray = df["pit_seconds"].notna() & ~df["is_pit_stop"]
    if stray.any():
        warnings.append(
            "Pit durations on laps not marked as pit stops were ignored."
        )
        df.loc[stray, "pit_seconds"] = np.nan

    # Stints and tyre age -------------------------------------------------
    df["stint"] = 1 + df["is_pit_stop"].shift(fill_value=False).cumsum().astype(int)
    stint_start = df.groupby("stint")["lap"].transform("min")
    df["tyre_age"] = (df["lap"] - stint_start + 1).astype(int)

    gaps = int(df["lap"].iloc[-1] - df["lap"].iloc[0] + 1 - len(df))
    if gaps > 0:
        warnings.append(f"{gaps} lap number(s) are missing from the sequence.")

    return Session(
        df=df,
        circuit=circuit,
        columns=columns,
        pit_source=pit_source,
        lap_time_unit="milliseconds" if is_ms else "seconds",
        warnings=warnings,
        dropped_rows=dropped,
    )
