from datetime import date

from pipeline.accuracy import pollster_accuracy
from pipeline.polls import Poll

ELECTION = date(2022, 10, 30)
RESULT = {"Lula": 50.9, "Bolsonaro": 49.1}


def poll(pollster, day, lula, bolsonaro):
    return Poll(pollster, date(2022, 10, day), 2000, {"Lula": lula, "Bolsonaro": bolsonaro, "undecided": 5.0})


def test_uses_last_poll_inside_window_and_ranks_by_error():
    polls = [
        poll("A", 10, 60, 30),  # too early: ignored
        poll("A", 28, 47.5, 47.5),
        poll("B", 29, 52, 43),
    ]
    rows = pollster_accuracy(polls, RESULT, ELECTION)
    assert [r["p"] for r in rows] == ["A", "B"]
    a = rows[0]
    assert a["d"] == 300
    assert a["shares"] == {"Lula": 50.0, "Bolsonaro": 50.0}
    assert a["meanError"] == 0.9
    assert a["marginError"] == 1.8


def test_rescales_total_votes_to_candidate_shares():
    # 45.81 / 44.19 in total votes is exactly the result in valid votes.
    rows = pollster_accuracy([poll("A", 29, 45.81, 44.19)], RESULT, ELECTION)
    assert rows[0]["meanError"] == 0.0


def test_ties_are_ordered_by_name():
    rows = pollster_accuracy([poll("Z", 29, 50, 45), poll("M", 29, 50, 45)], RESULT, ELECTION)
    assert [r["p"] for r in rows] == ["M", "Z"]


def test_polls_on_or_after_election_day_are_ignored():
    assert pollster_accuracy([poll("A", 30, 50, 45)], RESULT, ELECTION) == []
