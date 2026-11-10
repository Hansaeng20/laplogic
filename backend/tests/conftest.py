import logging
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
logging.disable(logging.INFO)

from main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


def make_race(
    stints,
    base=None,
    deg=None,
    fuel=-0.04,
    noise=0.08,
    in_lap_loss=8.0,
    out_lap_loss=14.0,
    start_loss=3.0,
    seed=1,
    outliers=None,
    header="lap,lap_time,compound,pit_stop",
    fmt="mmss",
):
    """Generate a deterministic race CSV.

    ``stints`` is a list of (compound, laps). Lap time follows the same
    structure Laplogic models, plus pit-lane, start and noise effects.
    """
    base = base or {"SOFT": 90.0, "MEDIUM": 90.6, "HARD": 91.2}
    deg = deg or {"SOFT": 0.12, "MEDIUM": 0.07, "HARD": 0.04}
    outliers = outliers or {}
    rng = np.random.default_rng(seed)
    rows, lap = [header], 0
    for s, (compound, length) in enumerate(stints):
        for age in range(1, length + 1):
            lap += 1
            t = base[compound] + deg[compound] * age + fuel * lap + rng.normal(0, noise)
            if lap == 1:
                t += start_loss
            pit = age == length and s < len(stints) - 1
            if pit:
                t += in_lap_loss
            if age == 1 and s > 0:
                t += out_lap_loss
            t += outliers.get(lap, 0.0)
            if fmt == "mmss":
                value = f"{int(t // 60)}:{t % 60:06.3f}"
            elif fmt == "ms":
                value = str(int(round(t * 1000)))
            else:
                value = f"{t:.3f}"
            rows.append(f"{lap},{value},{compound},{'yes' if pit else 'no'}")
    return "\n".join(rows) + "\n"


def upload(client, path, text, filename="race.csv", data=None, content_type="text/csv"):
    payload = text.encode() if isinstance(text, str) else text
    return client.post(
        path, files={"file": (filename, payload, content_type)}, data=data or {}
    )
