from datetime import date

import pytest

from pipeline.polls import DataError, Poll, day_of_year, poll_record, read_csv, validate

JAN, DEC = date(2026, 1, 1), date(2026, 12, 31)


def poll(pollster="Datafolha", end=date(2026, 9, 1), **values):
    return Poll(pollster, end, 2000, values or {"Lula": 40.0, "undecided": 10.0})


def test_day_of_year_counts_from_january_first():
    assert day_of_year(date(2026, 1, 1), 2026) == 0
    assert day_of_year(date(2026, 10, 4), 2026) == 276


def test_read_csv_skips_blank_cells(tmp_path):
    path = tmp_path / "race.csv"
    path.write_text("pollster,date,sample_size,Lula,Cury,undecided\nQuaest,2026-01-11,2004,36,,20\n")
    series, polls = read_csv(path)
    assert series == ["Lula", "Cury", "undecided"]
    assert polls == [Poll("Quaest", date(2026, 1, 11), 2004, {"Lula": 36.0, "undecided": 20.0})]


def test_read_csv_rejects_unexpected_header(tmp_path):
    path = tmp_path / "race.csv"
    path.write_text("institute,date,n,Lula\n")
    with pytest.raises(DataError, match="header"):
        read_csv(path)


def test_read_csv_reports_line_of_bad_date(tmp_path):
    path = tmp_path / "race.csv"
    path.write_text("pollster,date,sample_size,Lula\nQuaest,2026-13-01,,30\n")
    with pytest.raises(DataError, match="race.csv:2"):
        read_csv(path)


def test_validate_accepts_clean_polls():
    validate([poll(), poll("Quaest")], "test", JAN, DEC)


@pytest.mark.parametrize(
    ("polls", "message"),
    [
        ([poll(end=date(2025, 12, 31))], "outside"),
        ([poll(), poll()], "duplicate"),
        ([poll(Lula=-1.0)], "0–100"),
        ([poll(Lula=60.0, Flavio=45.0)], "add up"),
    ],
)
def test_validate_rejects_bad_data(polls, message):
    with pytest.raises(DataError, match=message):
        validate(polls, "test", JAN, DEC)


def test_validate_tolerates_rounding_across_many_candidates():
    # Eight integer-rounded values can legitimately add up to 102%.
    values = {f"c{i}": 12.0 for i in range(7)} | {"undecided": 18.0}
    validate([poll(**values)], "test", JAN, DEC)


def test_poll_record_keeps_series_order_and_omits_missing_sample():
    p = Poll("Quaest", date(2026, 1, 11), None, {"undecided": 20.0, "Lula": 36.0})
    assert poll_record(p, 2026, ["Lula", "Cury", "undecided"]) == {
        "p": "Quaest",
        "d": 10,
        "v": {"Lula": 36.0, "undecided": 20.0},
    }
