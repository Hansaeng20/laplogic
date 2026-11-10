import pytest

from tests.conftest import make_race, upload

OPTIMIZE = "/api/strategy/optimize"
COMPARE = "/api/strategy/compare"


def optimize(client, text, **data):
    response = upload(client, OPTIMIZE, text, data={k: str(v) for k, v in data.items()})
    assert response.status_code == 200, response.text
    return response.json()


def test_high_wear_recommends_extra_stop(client):
    # Heavy wear: one long stint per compound is slow, two stops pay off.
    text = make_race(
        [("MEDIUM", 14), ("HARD", 14), ("MEDIUM", 12)],
        deg={"SOFT": 0.3, "MEDIUM": 0.35, "HARD": 0.3},
        noise=0.05,
    )
    one_stop = make_race(
        [("MEDIUM", 20), ("HARD", 20)],
        deg={"SOFT": 0.3, "MEDIUM": 0.35, "HARD": 0.3},
        noise=0.05,
    )
    body = optimize(client, one_stop, simulator="F1 Series")
    assert body["recorded"]["stops"] == 1
    assert body["recommended"]["stops"] >= 2
    assert body["verdict"]["code"] in {"recommended", "likely"}
    assert body["gain"]["seconds"] > 0
    assert body["gain"]["low"] <= body["gain"]["seconds"] <= body["gain"]["high"]
    assert body["pit_loss"]["source"] == "measured"
    assert body["pit_loss"]["seconds"] == pytest.approx(22.0, abs=2.0)
    assert body["explanation"]
    # sanity: same physics with the identifiable 2-stop file is accepted too
    assert optimize(client, text, simulator="F1 Series")["status"] == "success"


def test_low_wear_keeps_one_stop(client):
    text = make_race(
        [("MEDIUM", 20), ("HARD", 20)],
        deg={"SOFT": 0.02, "MEDIUM": 0.02, "HARD": 0.01},
    )
    body = optimize(client, text, simulator="F1 Series")
    assert body["recommended"]["stops"] == 1
    assert body["verdict"]["code"] in {"keep", "inconclusive"}


def test_f1_rule_requires_two_compounds(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)])
    body = optimize(client, text, simulator="F1 Series")
    for plan in body["alternatives"]:
        assert len({s["compound"] for s in plan["stints"]}) >= 2


def test_no_rule_allows_single_compound_plans_within_limits(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)], deg={"SOFT": 0, "MEDIUM": 0.01, "HARD": 0.06})
    body = optimize(client, text, simulator="iRacing")
    limits = {c["compound"]: c["max_stint_laps"] for c in body["model"]["compounds"]}
    for plan in body["alternatives"]:
        assert sum(s["laps"] for s in plan["stints"]) == 40
        for stint in plan["stints"]:
            assert stint["laps"] <= limits[stint["compound"]]
    assert {s["compound"] for s in body["recommended"]["stints"]} == {"MEDIUM"}


def test_pit_loss_override_and_assumed_default(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)], in_lap_loss=0, out_lap_loss=0)
    body = optimize(client, text, simulator="F1 Series")
    assert body["pit_loss"]["source"] == "assumed"
    assert body["pit_loss"]["uncertainty"] > 0

    body = optimize(client, text, simulator="F1 Series", pit_loss=18.5)
    assert body["pit_loss"]["source"] == "user"
    assert body["pit_loss"]["seconds"] == 18.5


def test_noisy_data_does_not_overclaim(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)], noise=1.2, seed=7)
    body = optimize(client, text, simulator="F1 Series")
    if body["gain"] and body["verdict"]["code"] == "recommended":
        assert body["gain"]["seconds"] > 2 * body["gain"]["uncertainty_seconds"]


def test_insufficient_data_is_unsupported(client):
    body = optimize(client, "lap,lap_time,compound\n1,90,SOFT\n2,90,SOFT\n3,90,SOFT\n")
    assert body["verdict"]["code"] == "unsupported"
    assert body["recommended"] is None


def test_race_length_beyond_twice_upload_rejected(client):
    text = make_race([("MEDIUM", 10), ("HARD", 10)])
    response = upload(client, OPTIMIZE, text, data={"race_laps": "50"})
    assert response.status_code == 422


def test_compare_ranks_user_plan_against_alternative(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)])
    data = {
        "race_laps": "40", "strategy_type": "one_stop", "first_pit_lap": "20",
        "first_compound": "MEDIUM", "second_compound": "HARD", "pit_loss": "22",
    }
    response = upload(client, COMPARE, text, data=data)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["strategies"][0]["strategy"] == "Your Strategy"
    assert body["strategies"][0]["supported"]
    assert body["recommended"] in {s["strategy"] for s in body["strategies"]}
    assert set(body["pace_profiles"]) == {"MEDIUM", "HARD"}


def test_compare_flags_unknown_compound_and_long_stint(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)])
    base = {"race_laps": "40", "strategy_type": "one_stop", "pit_loss": "22"}

    unknown = upload(client, COMPARE, text, data={
        **base, "first_pit_lap": "20", "first_compound": "SOFT", "second_compound": "HARD",
    }).json()
    assert unknown["strategies"][0]["supported"] is False

    too_long = upload(client, COMPARE, text, data={
        **base, "first_pit_lap": "5", "first_compound": "MEDIUM", "second_compound": "HARD",
    }).json()
    assert too_long["strategies"][0]["supported"] is False
    assert "beyond" in too_long["strategies"][0]["reason"]


def test_compare_validates_pit_laps(client):
    text = make_race([("MEDIUM", 20), ("HARD", 20)])
    response = upload(client, COMPARE, text, data={
        "race_laps": "40", "strategy_type": "two_stop", "first_pit_lap": "20",
        "second_pit_lap": "10", "first_compound": "MEDIUM", "second_compound": "HARD",
        "third_compound": "MEDIUM",
    })
    assert response.status_code == 422


def test_health(client):
    assert client.get("/api/health").json()["status"] == "running"
