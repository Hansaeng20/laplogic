import pytest

from core.errors import DataError
from core.parsing import load_session, normalize_compound, parse_time
from tests.conftest import make_race, upload

ANALYZE = "/api/analyze/csv"


@pytest.mark.parametrize(
    "value, expected",
    [
        ("95.432", 95.432),
        ("1:35.432", 95.432),
        ("01:35.432", 95.432),
        ("0:01:35.432", 95.432),
        ("1.35.432", 95.432),
        ("95,432", 95.432),
        (95.432, 95.432),
    ],
)
def test_parse_time_formats(value, expected):
    assert parse_time(value) == pytest.approx(expected)


@pytest.mark.parametrize("value", ["", "abc", "-5", "0", "1:75.000", "1:2:3:4"])
def test_parse_time_rejects_invalid(value):
    with pytest.raises(ValueError):
        parse_time(value)


def test_compound_synonyms_are_normalized():
    assert normalize_compound(" softs ") == "SOFT"
    assert normalize_compound("Inter") == "INTERMEDIATE"
    assert normalize_compound("C3") == "C3"  # simulator-specific names are kept
    assert normalize_compound(None) == "UNKNOWN"


def test_alias_headers_semicolon_and_milliseconds():
    text = "Lap Number;LapTime_ms;Tyre;Pit\n1;95432;Soft;0\n2;94100;Soft;1\n3;96000;Hard;0\n4;94500;Hard;0\n"
    session = load_session(text.encode())
    assert session.lap_time_unit == "milliseconds"
    assert session.df["lap_seconds"].iloc[0] == pytest.approx(95.432)
    assert session.df["compound"].tolist() == ["SOFT", "SOFT", "HARD", "HARD"]
    assert session.df["is_pit_stop"].tolist() == [False, True, False, False]
    assert session.df["stint"].tolist() == [1, 1, 2, 2]


def test_pit_stops_inferred_from_compound_change():
    text = "lap,lap_time,compound\n1,90,MEDIUM\n2,90,MEDIUM\n3,90,HARD\n4,90,HARD\n"
    session = load_session(text.encode())
    assert session.pit_source == "compound_change"
    assert session.df["is_pit_stop"].tolist() == [False, True, False, False]
    assert any("inferred" in w for w in session.warnings)


def test_bad_rows_are_skipped_with_warning():
    text = "lap,lap_time\n1,90.1\n2,oops\n3,90.3\n4,90.2\n5,90.4\n"
    session = load_session(text.encode())
    assert session.dropped_rows == 1
    assert list(session.df["lap"]) == [1, 3, 4, 5]


def test_mostly_invalid_times_rejected():
    with pytest.raises(DataError):
        load_session(b"lap,lap_time\n1,x\n2,y\n3,z\n4,90\n")


def test_valid_upload_returns_analysis(client):
    response = upload(client, ANALYZE, make_race([("MEDIUM", 12), ("HARD", 13)]))
    assert response.status_code == 200
    body = response.json()
    assert body["total_laps"] == 25
    assert body["pit_analysis"]["total_pit_stops"] == 1
    assert [s["compound"] for s in body["stints"]] == ["MEDIUM", "HARD"]


@pytest.mark.parametrize(
    "text, filename, status, fragment",
    [
        ("lap,lap_time\n1,90\n", "race.txt", 400, ".csv"),
        ("", "race.csv", 400, "empty"),
        ("lap,speed\n1,200\n2,201\n3,199\n", "race.csv", 422, "lap-time column"),
        ("lap,lap_time\n1,90\n1,91\n2,90\n", "race.csv", 422, "Duplicate"),
        ("lap,lap_time\n1,90\n2,91\n", "race.csv", 422, "At least"),
        ("lap,lap_time,pit_stop\n1,90,maybe\n2,90,no\n3,90,no\n", "race.csv", 422, "maybe"),
        (
            "track,lap,lap_time\nMonza,1,90\nSpa,2,91\nSpa,3,92\n",
            "race.csv", 422, "multiple circuits",
        ),
        ("lap,lap_time\n1.5,90\n2,91\n3,92\n", "race.csv", 422, "positive integers"),
    ],
)
def test_invalid_uploads(client, text, filename, status, fragment):
    response = upload(client, ANALYZE, text, filename=filename)
    assert response.status_code == status
    assert fragment.lower() in response.json()["detail"].lower()


def test_binary_upload_rejected(client):
    response = upload(client, ANALYZE, b"\x00\x01\x02lap", filename="race.csv")
    assert response.status_code == 400


def test_oversized_upload_rejected(client):
    big = "lap,lap_time\n" + "1,90.000\n" * 500_000
    response = upload(client, ANALYZE, big)
    assert response.status_code == 413


def test_wrong_content_type_rejected(client):
    response = upload(client, ANALYZE, "lap,lap_time\n1,90\n", content_type="image/png")
    assert response.status_code == 415
