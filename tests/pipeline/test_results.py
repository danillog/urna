from datetime import date

from pipeline.accuracy import pollster_accuracy
from pipeline.polls import Poll
from pipeline.results import match


def tse(*cands):
    return [{"name": n, "party": p, "share": s} for n, p, s in cands]


def test_match_by_party_then_name():
    official = tse(
        ("CARLOS PORTINHO", "PL", 20.0),
        ("CARLOS JORDY", "PL", 18.0),
        ("BENEDITA DA SILVA", "PT", 15.0),
        ("TARCÍSIO", "REPUBLICANOS", 50.0),
    )
    shares, missing = match(
        {
            "Carlos Jordy": "PL",
            "Carlos Portinho": "PL",
            "Benedita": "PT",
            "Tarcísio": "Republicanos",
            "Salles": "NOVO",
        },
        official,
    )
    assert shares == {"Carlos Jordy": 18.0, "Carlos Portinho": 20.0, "Benedita": 15.0, "Tarcísio": 50.0}
    assert missing == ["Salles"]  # not on the ballot


def test_match_survives_a_wrong_party_in_the_poll_file():
    shares, missing = match({"Ciro Gomes": "PSDB"}, tse(("CIRO GOMES", "PDT", 40.0), ("ELMANO", "PT", 45.0)))
    assert shares == {"Ciro Gomes": 40.0} and not missing


def test_a_poll_without_a_minor_candidate_still_counts():
    result = {"A": 50.0, "B": 45.0, "C": 5.0}
    day = date(2026, 10, 1)
    polls = [
        Poll("Full", day, 1000, {"A": 50, "B": 45, "C": 5}),
        Poll("NoC", day, 1000, {"A": 47.5, "B": 47.5}),  # left C out
        Poll("NoB", day, 1000, {"A": 60, "C": 10}),  # no runner-up: no margin, left out
    ]
    rows = {r["p"]: r for r in pollster_accuracy(polls, result, date(2026, 10, 4))}
    assert set(rows) == {"Full", "NoC"}
    assert rows["Full"]["meanError"] == 0
    # NoC is compared on A and B only, both rescaled: truth 52.6/47.4, poll 50/50.
    assert rows["NoC"]["meanError"] == 2.63
