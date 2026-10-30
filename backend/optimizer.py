
from fastapi import APIRouter, File, HTTPException, UploadFile
import pandas as pd
import numpy as np
from io import BytesIO
from itertools import product

router = APIRouter(prefix="/api/strategy", tags=["Strategy Advisor"])


def seconds(value):
    text = str(value).strip()
    if ":" in text:
        parts = [float(p) for p in text.split(":")]
        result = 0.0
        for part in parts:
            result = result * 60 + part
        return result
    return float(text)


def is_pit(value):
    return str(value).strip().lower() in {
        "yes", "true", "1", "y"
    }


def fmt(value):
    minutes = int(value // 60)
    return f"{minutes}:{value % 60:06.3f}"


@router.post("/optimize")
async def optimize_strategy(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a CSV file.")

    try:
        raw = await file.read()
        if len(raw) > 4_000_000:
            raise ValueError("CSV exceeds the 4 MB upload limit.")

        df = pd.read_csv(BytesIO(raw))
        df.columns = [
            c.strip().lower().replace(" ", "_")
            for c in df.columns
        ]

        required = {"lap", "lap_time", "compound", "pit_stop"}
        if not required.issubset(df.columns):
            raise ValueError(
                "CSV must have lap, lap_time, compound, and pit_stop columns."
            )

        df["lap"] = pd.to_numeric(df["lap"], errors="raise").astype(int)
        df["time"] = df["lap_time"].apply(seconds)
        df["compound"] = df["compound"].astype(str).str.upper().str.strip()
        df["is_pit"] = df["pit_stop"].apply(is_pit)
        df = df.sort_values("lap").reset_index(drop=True)

        if (
            df.empty
            or df["lap"].tolist() != list(range(1, len(df) + 1))
            or not np.isfinite(df["time"]).all()
            or (df["time"] <= 0).any()
        ):
            raise ValueError(
                "Lap numbers must be consecutive starting at 1, "
                "with positive, valid lap times."
            )

        race_laps = len(df)
        pit_laps = df.loc[df["is_pit"], "lap"].tolist()

        if not pit_laps or len(pit_laps) > 2:
            raise ValueError(
                "This version supports races with 1 or 2 recorded pit stops."
            )

        if pit_laps[-1] >= race_laps:
            raise ValueError("The final lap cannot be a pit-stop lap.")

        # Determine the recorded stint compounds and each lap's tyre age.
        starts = [1] + [p + 1 for p in pit_laps]
        ends = pit_laps + [race_laps]
        compounds = []
        for start, end in zip(starts, ends):
            stint = df[(df.lap >= start) & (df.lap <= end)]
            dry_laps = stint[~stint.is_pit]
            if len(dry_laps) < 4:
                raise ValueError(
                    "Each stint needs at least 4 non-pit laps "
                    "for a basic pace estimate."
                )
            compounds.append(dry_laps.compound.mode().iloc[0])

        df["tyre_age"] = 0
        for start, end in zip(starts, ends):
            mask = df.lap.between(start, end)
            df.loc[mask, "tyre_age"] = df.loc[mask, "lap"] - start + 1

        # Fit a basic lap-time trend for each recorded compound.
        # Exclude pit-stop laps to prevent pit losses distorting pace.
        profiles = {}
        for compound in set(compounds):
            observations = df[
                (df.compound == compound) & (~df.is_pit)
            ]
            if len(observations) < 4:
                raise ValueError(
                    f"Not enough clean laps for {compound}."
                )

            ages = observations.tyre_age.to_numpy(dtype=float)
            times = observations.time.to_numpy(dtype=float)

            if len(np.unique(ages)) >= 2:
                slope, intercept = np.polyfit(ages, times, 1)
            else:
                slope, intercept = 0.0, float(np.mean(times))

            # Conservative degradation-only model:
            # do not infer that tyres get faster with age.
            slope = float(np.clip(slope, 0, 0.8))
            intercept = float(np.mean(times) - slope * np.mean(ages))

            profiles[compound] = {
                "base": intercept,
                "degradation_per_lap": slope,
                "max_observed_age": int(ages.max())
            }

        # Estimate the pit-loss component from recorded pit laps,
        # subtracting expected normal running pace first.
        pit_losses = []
        for _, row in df[df.is_pit].iterrows():
            profile = profiles.get(row.compound)
            if profile is None:
                continue

            expected = (
                profile["base"]
                + profile["degradation_per_lap"] * row.tyre_age
            )
            pit_losses.append(max(0.0, float(row.time - expected)))

        if "pit_duration" in df.columns:
            durations = pd.to_numeric(
                df.loc[df.is_pit, "pit_duration"],
                errors="coerce"
            ).dropna()
        else:
            durations = pd.Series(dtype=float)

        # Pit time is modeled as an addition to clean running pace.
        # When available, prefer excess time on the recorded pit lap.
        # Fall back to the CSV's pit_duration values.
        if pit_losses and max(pit_losses) > 5:
            pit_loss = float(np.median(pit_losses))
            pit_source = "estimated from recorded pit laps"
        elif len(durations) > 0:
            pit_loss = float(durations.median())
            pit_source = "pit_duration column"
        else:
            raise ValueError(
                "Could not estimate pit loss from the recorded data."
            )

        if not np.isfinite(pit_loss) or pit_loss <= 0:
            raise ValueError("A positive pit-loss estimate is required.")

        original_lengths = [
            end - start + 1
            for start, end in zip(starts, ends)
        ]

        def evaluate(lengths):
            if sum(lengths) != race_laps:
                return None

            total = pit_loss * len(pit_laps)
            for length, compound in zip(lengths, compounds):
                profile = profiles[compound]

                # No unsupported long-stint extrapolation.
                if length > profile["max_observed_age"] + 1:
                    return None

                base = profile["base"]
                degradation = profile["degradation_per_lap"]

                total += (
                    length * base
                    + degradation * length * (length + 1) / 2
                )

            return float(total)

        baseline = evaluate(original_lengths)
        if baseline is None:
            raise ValueError(
                "Recorded stints exceed supported model range."
            )

        # Search pit windows within 4 laps of each recorded stop.
        # Keeps the recommendation close to observed race data.
        windows = [
            range(max(4, p - 4), min(race_laps - 4, p + 4) + 1)
            for p in pit_laps
        ]

        candidates = []
        for proposed_pits in product(*windows):
            proposed_pits = list(proposed_pits)

            if proposed_pits != sorted(set(proposed_pits)):
                continue

            boundaries = [0] + proposed_pits + [race_laps]
            lengths = [
                boundaries[i + 1] - boundaries[i]
                for i in range(len(boundaries) - 1)
            ]

            if min(lengths) < 4:
                continue

            estimated = evaluate(lengths)
            if estimated is None:
                continue

            candidates.append({
                "pit_laps": proposed_pits,
                "stint_lengths": lengths,
                "estimated_time_seconds": round(estimated, 3)
            })

        if not candidates:
            raise ValueError(
                "No supported alternative strategy found."
            )

        candidates.sort(key=lambda x: x["estimated_time_seconds"])
        best = candidates[0]

        gain = max(0.0, baseline - best["estimated_time_seconds"])
        changed = best["pit_laps"] != pit_laps

        if gain < 0.5:
            verdict = "Keep your recorded pit strategy"
            reason = (
                "The model found no meaningful improvement "
                "within the supported pit windows."
            )
        else:
            verdict = "Adjust your pit-stop timing"
            reason = (
                "The suggested stint lengths have a lower modeled "
                "lap-time total based on the recorded pace trends."
            )

        details = []
        first = 1
        for i, (length, compound) in enumerate(
            zip(best["stint_lengths"], compounds)
        ):
            last = first + length - 1
            details.append({
                "stint": i + 1,
                "compound": compound,
                "start_lap": first,
                "end_lap": last,
                "laps": length
            })
            first = last + 1

        return {
            "status": "success",
            "advisor": "Laplogic Strategy Advisor v1",
            "race_laps": race_laps,
            "original_pit_laps": pit_laps,
            "recommended_pit_laps": best["pit_laps"],
            "original_estimated_time": round(baseline, 3),
            "recommended_estimated_time": best["estimated_time_seconds"],
            "potential_gain_seconds": round(gain, 3),
            "potential_gain_display": fmt(gain),
            "verdict": verdict,
            "reason": reason,
            "change_recommended": changed and gain >= 0.5,
            "recommended_stints": details,
            "pit_loss_seconds": round(pit_loss, 3),
            "pit_loss_source": pit_source,
            "evaluated_candidates": len(candidates),
            "model": "Basic linear tyre-age pace model",
            "confidence": "Experimental",
            "limitations": [
                "Uses only the recorded compound order and 1–2 pit stops.",
                "Optimizes pit windows near the recorded pit stops.",
                "Does not model fuel load, traffic, weather or safety cars.",
                "Cannot verify simulator tyre, fuel or pit-stop rules.",
                "Predicted gains are estimates, not guaranteed results.",
                "Synthetic CSV data produces synthetic recommendations."
            ]
        }

    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to analyze the uploaded race CSV."
        )
