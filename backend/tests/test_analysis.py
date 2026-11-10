import pytest

from core.laps import classify_laps
from core.model import fit_pace_model
from core.parsing import load_session
from tests.conftest import make_race, upload


def laps_for(text):
    return classify_laps(load_session(text.encode()).df)


def test_start_pit_and_outlier_laps_are_not_clean():
    laps = laps_for(make_race([("MEDIUM", 15), ("HARD", 15)], outliers={8: 6.0}))
    by_lap = laps.set_index("lap")
    assert by_lap.loc[1, "exclusion"] == "first_lap"
    assert by_lap.loc[15, "exclusion"] == "in_lap"
    assert by_lap.loc[16, "exclusion"] == "out_lap"
    assert by_lap.loc[8, "is_outlier"]
    assert by_lap.loc[10, "is_clean"]


def test_degradation_and_fuel_recovered_when_identifiable():
    # MEDIUM is used twice, so fuel burn can be separated from tyre wear.
    text = make_race([("MEDIUM", 12), ("HARD", 14), ("MEDIUM", 12)], noise=0.03)
    model = fit_pace_model(laps_for(text))
    assert model.fuel_mode == "estimated"
    assert model.fuel_per_lap == pytest.approx(-0.04, abs=0.01)
    assert model.compounds["MEDIUM"].degradation == pytest.approx(0.07, abs=0.015)
    assert model.compounds["HARD"].degradation == pytest.approx(0.04, abs=0.015)


def test_fuel_not_estimated_when_confounded():
    model = fit_pace_model(laps_for(make_race([("MEDIUM", 15), ("HARD", 15)])))
    assert model.fuel_mode == "none"


def test_negative_wear_is_constrained_to_zero():
    text = make_race(
        [("MEDIUM", 15), ("HARD", 15)],
        deg={"SOFT": 0, "MEDIUM": 0.05, "HARD": -0.05},
        fuel=0.0,
        noise=0.02,
    )
    model = fit_pace_model(laps_for(text))
    assert model.compounds["HARD"].degradation == 0.0
    assert model.compounds["HARD"].degradation_constrained


def test_analysis_endpoint_reports_insights_and_pit_loss(client):
    text = make_race([("MEDIUM", 15), ("HARD", 15)], outliers={8: 6.0})
    body = upload(client, "/api/analyze/csv", text).json()

    stop = body["pit_analysis"]["stops"][0]
    assert stop["compound_after"] == "HARD"
    assert stop["time_loss"] == pytest.approx(22.0, abs=1.5)

    lap8 = next(l for l in body["laps"] if l["lap"] == 8)
    assert lap8["is_outlier"] and not lap8["is_clean"]
    # 30 laps minus start, in-lap, out-lap and the outlier
    assert body["statistics"]["clean_laps"] == 26
    titles = " ".join(i["title"] for i in body["insights"])
    assert "unusual lap" in titles


def test_invalid_laps_are_excluded_from_best_lap(client):
    text = "lap,lap_time,valid\n1,95\n2,91,1\n3,85,0\n4,91.2,1\n5,91.1,1\n6,91.3,1\n"
    body = upload(client, "/api/analyze/csv", text).json()
    assert body["statistics"]["best_lap_number"] != 3
    lap3 = next(l for l in body["laps"] if l["lap"] == 3)
    assert lap3["valid"] is False and lap3["exclusion"]
