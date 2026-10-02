import re
from datetime import date

import pytest

from pipeline import crawl
from pipeline.pollsters import Pollster, PollsterRegistry
from pipeline.sources.tse_registry import Registration
from pipeline.sources.wikipedia import Scenario, WikiPoll

ALIASES = {"Lula": "Lula", "F. Bolsonaro": "Flávio", "Cury": "Cury"}
POLLSTERS = PollsterRegistry(
    [
        Pollster("Datafolha", re.compile("datafolha", re.I), "in_person"),
        Pollster("Real Time Big Data", re.compile("real ?time", re.I), "phone"),
    ]
)
ELECTION = {
    "candidates": {"Lula": {}, "Flávio": {"wikipedia": "F. Bolsonaro"}, "Cury": {}},
    "rounds": {
        "r1": {"date": date(2026, 10, 4), "skip_polls": [["Datafolha", date(2026, 9, 1), "valid votes"]]},
        "r2": {"date": date(2026, 10, 25)},
    },
}


def wiki(pollster, end, *scenarios, n=2000):
    return WikiPoll(pollster, f"{end:%d %b}", end, n, [Scenario(s) for s in scenarios])


def test_column_series():
    assert crawl.column_series("Lula PT", ALIASES) == "Lula"
    assert crawl.column_series("F. Bolsonaro PL", ALIASES) == "Flávio"
    assert crawl.column_series("Blank Null Undec.", ALIASES) == "undecided"
    assert crawl.column_series("Others", ALIASES) == "others"
    assert crawl.column_series("Caiado PSD", ALIASES) is None


def test_to_series_folds_untracked_candidates_into_others():
    values = {
        "Lula PT": 42,
        "F. Bolsonaro PL": 38,
        "Caiado PSD": 3,
        "Zema Novo": 1,
        "Others": 2,
        "Blank Null Undec.": 7,
    }
    out = crawl.to_series(values, ALIASES, ["Lula", "Flávio", "Cury", "others", "undecided"])
    assert out == {"Lula": 42, "Flávio": 38, "others": 6, "undecided": 7}


def test_runoff_picks_the_exact_matchup():
    poll = wiki(
        "Datafolha",
        date(2026, 9, 30),
        {"Lula PT": 48, "Caiado PSD": 40, "Blank Null Undec.": 12},
        {"Lula PT": 48, "F. Bolsonaro PL": 45, "Blank Null Undec.": 7},
    )
    assert crawl.pick_scenario(poll, ALIASES, ["Lula", "Flávio"], runoff=True) == poll.scenarios[1].values


def test_first_round_picks_the_scenario_with_all_tested_candidates():
    poll = wiki(
        "Datafolha",
        date(2026, 9, 30),
        {"Lula PT": 44, "F. Bolsonaro PL": 40, "Blank Null Undec.": 8},
        {"Lula PT": 42, "F. Bolsonaro PL": 38, "Cury Avante": 4, "Blank Null Undec.": 7},
    )
    assert (
        crawl.pick_scenario(poll, ALIASES, ["Lula", "Flávio", "Cury"], runoff=False)
        == poll.scenarios[1].values
    )


@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(crawl, "RAW", tmp_path)
    (tmp_path / "2026-r1.csv").write_text(
        "pollster,date,sample_size,Lula,Flávio,Cury,others,undecided\n"
        "Datafolha,2026-09-23,2000,41,37,5,9,8\n"
        "Real Time Big Data,2026-09-20,2000,40,36,,,10\n"
    )
    return tmp_path


def registration(pollster, end):
    return Registration("BR1", pollster, frozenset({"president"}), "BR", end, end, end, 2000)


def test_crawl_round_adds_new_polls_and_reports_the_rest(raw_dir):
    polls = [
        # Already in the CSV, one day apart and with different numbers.
        wiki("Datafolha", date(2026, 9, 24), {"Lula PT": 44, "F. Bolsonaro PL": 37, "Blank Null Undec.": 8}),
        # New, confirmed by the registry.
        wiki(
            "Datafolha",
            date(2026, 9, 30),
            {"Lula PT": 42, "F. Bolsonaro PL": 38, "Cury Avante": 4, "Others": 2, "Blank Null Undec.": 7},
        ),
        # New pollster, not registered: needs a human.
        wiki(
            "Instituto X", date(2026, 9, 29), {"Lula PT": 40, "F. Bolsonaro PL": 40, "Blank Null Undec.": 9}
        ),
        # Established pollster, not registered: added but flagged.
        wiki("Real Time", date(2026, 9, 28), {"Lula PT": 43, "F. Bolsonaro PL": 39, "Blank Null Undec.": 6}),
        # No undecided column: probably valid votes only.
        wiki("Datafolha", date(2026, 9, 27), {"Lula PT": 52, "F. Bolsonaro PL": 48}),
        # Listed in skip_polls.
        wiki("Datafolha", date(2026, 9, 1), {"Lula PT": 50, "F. Bolsonaro PL": 40, "Blank Null Undec.": 5}),
    ]
    regs = [registration("DATAFOLHA", date(2026, 9, 30)), registration("DATAFOLHA", date(2026, 9, 27))]
    report = crawl.crawl_round(2026, "r1", ELECTION, POLLSTERS, polls, regs, dry_run=False)

    assert [(r["pollster"], r["date"]) for r in report.added] == [
        ("Datafolha", "2026-09-30"),
        ("Real Time Big Data", "2026-09-28"),
    ]
    assert report.added[0] == {
        "pollster": "Datafolha",
        "date": "2026-09-30",
        "sample_size": "2000",
        "Lula": "42",
        "Flávio": "38",
        "Cury": "4",
        "others": "2",
        "undecided": "7",
    }
    assert report.unconfirmed == ["Real Time Big Data 28/09 (28 Sep)"]
    assert any("Instituto X" in r and "new pollster" in r for r in report.review)
    assert any("valid votes" in r for r in report.review)
    assert report.disagreements == ["Datafolha 24/09 (24 Sep): dataset × Wikipedia: Lula 41 × 44"]

    lines = (raw_dir / "2026-r1.csv").read_text().splitlines()
    assert [line.split(",")[1] for line in lines[1:]] == [
        "2026-09-20",
        "2026-09-23",
        "2026-09-28",
        "2026-09-30",
    ]


def test_dry_run_changes_nothing(raw_dir):
    before = (raw_dir / "2026-r1.csv").read_text()
    poll = wiki(
        "Datafolha", date(2026, 9, 30), {"Lula PT": 42, "F. Bolsonaro PL": 38, "Blank Null Undec.": 7}
    )
    report = crawl.crawl_round(2026, "r1", ELECTION, POLLSTERS, [poll], None, dry_run=True)
    assert len(report.added) == 1
    assert (raw_dir / "2026-r1.csv").read_text() == before


def test_registry_checklist():
    dataset = {
        "presidential": {"2026": {"year": 2026, "rounds": {"r1": {"polls": [{"p": "Datafolha", "d": 272}]}}}},
        "states": {
            "SP": {
                "governor": {"r1": {"date": "2026-10-04", "polls": [{"p": "Quaest", "d": 260}]}},
                "senate": {},
            }
        },
    }
    regs = [
        registration("DATAFOLHA", date(2026, 9, 30)),  # have it (day 272 = 30/09)
        registration("DATAFOLHA", date(2026, 9, 16)),  # missing
        registration("Real Time Big Data", date(2026, 10, 1)),  # pending from Wikipedia
        Registration(
            "BR2",
            "REAL TIME BIG DATA",
            frozenset({"president"}),
            None,
            date(2026, 9, 1),
            date(2026, 9, 2),
            date(2026, 9, 3),
            1600,
        ),  # scope unclear
        Registration(
            "SP1",
            "QUAEST",
            frozenset({"governor", "senate"}),
            "SP",
            date(2026, 9, 20),
            date(2026, 9, 25),
            date(2026, 9, 26),
            1500,
        ),  # missing in SP
        Registration(
            "BR3",
            "DATAFOLHA",
            frozenset({"president"}),
            "BR",
            date(2026, 10, 1),
            date(2026, 10, 3),
            date(2026, 10, 3),
            2500,
        ),  # not released yet
    ]
    check = crawl.registry_checklist(
        regs,
        dataset,
        PollsterRegistry([*POLLSTERS._pollsters, Pollster("Quaest", re.compile("quaest", re.I), None)]),
        date(2026, 10, 2),
        {("Real Time Big Data", date(2026, 10, 1))},
    )
    assert [(m.pollster, m.end) for m in check.national] == [("Datafolha", date(2026, 9, 16))]
    assert check.unclear == {"Real Time Big Data": [date(2026, 9, 2)]}
    assert [(m.scope, m.pollster) for m in check.states] == [("SP", "Quaest")]
    assert [(m.pollster, m.end) for m in check.upcoming] == [("Datafolha", date(2026, 10, 3))]
    assert crawl.summarize_states(check.states) == ["SP: 1 · last 25/09 · Quaest 1"]
