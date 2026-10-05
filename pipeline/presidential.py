"""Presidential races: data/raw/presidential/<year>-<round>.csv + data/elections.yaml."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from pathlib import Path

from . import results
from .accuracy import pollster_accuracy
from .polls import (
    OTHERS,
    SPECIAL_SERIES,
    UNDECIDED,
    DataError,
    Poll,
    day_of_year,
    poll_record,
    read_csv,
    validate,
)
from .pollsters import PollsterRegistry

DEFAULT_COLORS = {OTHERS: "violet", UNDECIDED: "gray"}


def derive_others(poll: Poll, series: list[str]) -> Poll:
    """Fills "others" as what is left of 100% when the source only lists the leaders."""
    if OTHERS in poll.values or UNDECIDED not in poll.values:
        return poll
    named = sum(v for s, v in poll.values.items() if s not in SPECIAL_SERIES)
    others = round(100 - named - poll.values[UNDECIDED], 1)
    return replace(poll, values={**poll.values, OTHERS: others}) if OTHERS in series else poll


def build_round(
    year: int, round_id: str, spec: dict, election: dict, raw_dir: Path, pollsters: PollsterRegistry
) -> dict:
    path = raw_dir / f"{year}-{round_id}.csv"
    series, polls = read_csv(path)
    unknown = [s for s in series if s not in SPECIAL_SERIES and s not in election["candidates"]]
    if unknown:
        raise DataError(f"{path.name}: candidates missing from elections.yaml: {', '.join(unknown)}")

    election_date: date = spec["date"]
    polls = [replace(p, pollster=pollsters.normalize(p.pollster)) for p in polls]
    if spec.get("derive_others"):
        polls = [derive_others(p, series) for p in polls]
    polls.sort(key=lambda p: p.end_date)
    validate(polls, path.name, date(year, 1, 1), election_date)

    candidates = election["candidates"]
    result = spec.get("result")
    official = results.load(year, round_id) if not result else None
    if official:
        # 2026 on: read from the TSE's files (pipeline.results) instead of typed in.
        shares, _ = results.match(
            {c: m["party"] for c, m in candidates.items() if c in series}, official["president"]["candidates"]
        )
        result = shares or None
    return {
        "date": election_date.isoformat(),
        "electionDay": day_of_year(election_date, year),
        "series": series,
        "colors": {**DEFAULT_COLORS, **{c: m["color"] for c, m in candidates.items()}},
        "parties": {c: m["party"] for c, m in candidates.items() if c in series},
        "dashed": [c for c, m in candidates.items() if m.get("dashed") and c in series],
        "polls": [poll_record(p, year, series) for p in polls],
        "result": result,
        "winner": spec.get("winner"),
        "accuracy": pollster_accuracy(polls, result, election_date) if result else [],
        "validVotesOnly": bool(spec.get("valid_votes_only")),
        "notes": spec.get("notes", []),
    }


def build_presidential(elections: dict, raw_dir: Path, pollsters: PollsterRegistry) -> dict:
    out = {}
    for year_key, election in elections.items():
        if not election.get("rounds"):  # map-only entry: candidates, no poll data
            continue
        year = int(year_key)
        out[year_key] = {
            "year": year,
            "context": election["context"],
            "events": [
                {
                    "day": day_of_year(e["date"], year),
                    "label": e["label"],
                    "row": e.get("row", 0),
                    "pinned": e.get("pinned", False),
                }
                for e in election.get("events", [])
            ],
            "rounds": {
                round_id: build_round(year, round_id, spec, election, raw_dir, pollsters)
                for round_id, spec in election["rounds"].items()
            },
        }
    return out
