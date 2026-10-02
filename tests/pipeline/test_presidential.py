from datetime import date

from pipeline.polls import Poll
from pipeline.presidential import derive_others

SERIES = ["Lula", "Flávio", "others", "undecided"]


def test_derive_others_from_undecided():
    p = Poll("Quaest", date(2026, 1, 11), 2004, {"Lula": 36.0, "Flávio": 23.0, "undecided": 20.0})
    assert derive_others(p, SERIES).values["others"] == 21.0


def test_derive_others_keeps_published_value():
    p = Poll("Ideia", date(2026, 9, 7), 1500, {"Lula": 38.4, "Flávio": 37.3, "others": 11.0})
    assert derive_others(p, SERIES) is p
