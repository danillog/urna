from datetime import date

from pipeline.polls import Poll
from pipeline.states import assign_colors, display_party, rank_candidates

CONFIG = {"party_colors": {"PT": "red", "PL": "blue"}, "fallback_colors": ["gold", "teal", "red", "blue"]}


def test_rank_uses_recent_average_and_drops_untested_names():
    polls = [
        Poll("A", date(2026, 3, 1), None, {"X": 50.0, "Y": 10.0}),
        Poll("A", date(2026, 9, 1), None, {"X": 20.0, "Y": 30.0}),
    ]
    assert rank_candidates(polls, ["X", "Y", "Z"]) == ["Y", "X"]


def test_party_colors_first_then_fallback():
    colors = assign_colors(["A", "B", "C"], {"A": "Novo", "B": "PL", "C": "PL"}, CONFIG)
    assert colors["B"] == "blue"
    assert colors["A"] == "gold"
    assert colors["C"] == "teal"  # blue is taken by the first PL candidate
    assert colors["others"] == "violet"


def test_display_party():
    assert display_party("REPUBLICANOS") == "Republicanos"
    assert display_party("PSDB") == "PSDB"
