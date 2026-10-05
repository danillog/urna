"""Governor and Senate races: data/raw/states/<UF>.json + data/states.yaml."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .accuracy import pollster_accuracy
from .polls import OTHERS, UNDECIDED, DataError, Poll, day_of_year, poll_record, validate
from .pollsters import PollsterRegistry
from .results import match

RACES = {"governor_r1": ("governor", "r1"), "governor_r2": ("governor", "r2"), "senate_r1": ("senate", "r1")}
# Party names longer than this are written out ("Republicanos") instead of as acronyms.
ACRONYM_MAX_LENGTH = 6
# Candidates are ranked by their average over the last month of polling.
RANKING_WINDOW_DAYS = 30


def display_party(party: str) -> str:
    return party.capitalize() if party.isupper() and len(party) > ACRONYM_MAX_LENGTH else party


def rank_candidates(polls: list[Poll], names: list[str]) -> list[str]:
    """Orders candidates by their recent average, leaving out names no poll tested."""
    last = max(p.end_date for p in polls)
    recent = [p for p in polls if (last - p.end_date).days <= RANKING_WINDOW_DAYS] or polls

    def recent_average(name: str) -> float:
        vals = [p.values[name] for p in recent if name in p.values]
        return sum(vals) / len(vals) if vals else -1

    tested = [n for n in names if any(n in p.values for p in polls)]
    return sorted(tested, key=recent_average, reverse=True)


def assign_colors(named: list[str], parties: dict[str, str], config: dict) -> dict[str, str]:
    colors: dict[str, str] = {}
    for name in named:
        color = config["party_colors"].get((parties.get(name) or "").upper())
        if color and color not in colors.values():
            colors[name] = color
    for name in named:
        if name not in colors:
            colors[name] = next(c for c in config["fallback_colors"] if c not in colors.values())
    return {**colors, OTHERS: "violet", UNDECIDED: "gray"}


def load_polls(uf: str, race: str, block: dict, config: dict, pollsters: PollsterRegistry) -> list[Poll]:
    window = config["poll_window"]
    excluded = {(u, r, p, str(d)) for u, r, p, d in config["excluded_polls"]}
    polls = []
    for raw in block["polls"]:
        name = pollsters.normalize(raw["p"])
        if {(uf, race, raw["p"], raw["date"]), (uf, race, name, raw["date"])} & excluded:
            continue
        p = Poll(
            name,
            date.fromisoformat(raw["date"]),
            int(raw["n"]) if raw.get("n") else None,
            {k: float(v) for k, v in raw["v"].items()},
        )
        if window["start"] <= p.end_date <= window["end"]:
            polls.append(p)
    polls.sort(key=lambda p: p.end_date)
    validate(polls, f"{uf}.json {race}", window["start"], window["end"])
    return polls


def not_on_ballot(names: list[str]) -> str:
    return (
        f"{' e '.join(names) if len(names) < 3 else ', '.join(names)} não "
        f"{'aparece' if len(names) == 1 else 'aparecem'} no resultado oficial do TSE: "
        "a comparação com as pesquisas usa só quem recebeu votos."
    )


def build_race(
    uf: str,
    race: str,
    block: dict,
    config: dict,
    election_date: date,
    pollsters: PollsterRegistry,
    official: list[dict] | None = None,
) -> dict | None:
    polls = load_polls(uf, race, block, config, pollsters)
    if not polls:
        return None
    parties: dict[str, str] = block.get("candidates", {})
    ranked = rank_candidates(polls, list(parties))
    if race == "governor_r2":
        named = [c for c in block.get("matchup", []) if c in parties] or ranked[:2]
    else:
        named = ranked[: config["max_named_candidates"]]
    folded = [c for c in ranked if c not in named]

    # Collapse everyone outside the named lines into "others" (runoffs have no others).
    collapsed = []
    for p in polls:
        values = {c: p.values[c] for c in named if c in p.values}
        rest = [p.values[c] for c in folded if c in p.values]
        if OTHERS in p.values:
            rest.append(p.values[OTHERS])
        if rest and race != "governor_r2":
            values[OTHERS] = round(sum(rest), 1)
        if UNDECIDED in p.values:
            values[UNDECIDED] = p.values[UNDECIDED]
        collapsed.append(Poll(p.pollster, p.end_date, p.sample_size, values))

    has_others = any(p.values.get(OTHERS) for p in collapsed)
    has_undecided = any(UNDECIDED in p.values for p in collapsed)
    series = named + ([OTHERS] if has_others else []) + ([UNDECIDED] if has_undecided else [])
    year = election_date.year
    result, notes = None, []
    if official:
        shares, missing = match(parties, official)
        result = {c: shares[c] for c in named if c in shares} or None
        if missing:
            notes.append(not_on_ballot(missing))
    return {
        "date": election_date.isoformat(),
        "electionDay": day_of_year(election_date, year),
        "series": series,
        "colors": assign_colors(named, parties, config),
        "parties": {c: display_party(parties.get(c, "")) for c in named},
        "dashed": [],
        "polls": [poll_record(p, year, series) for p in collapsed],
        "result": result,
        "winner": None,
        "accuracy": pollster_accuracy(collapsed, result, election_date) if result else [],
        "validVotesOnly": False,
        "notes": notes,
        "folded": folded,
    }


def build_states(
    config: dict,
    raw_dir: Path,
    round_dates: dict[str, date],
    pollsters: PollsterRegistry,
    results: dict | None = None,
) -> dict:
    out = {}
    for path in sorted(raw_dir.glob("*.json")):
        source = json.loads(path.read_text(encoding="utf-8"))
        uf = source["uf"]
        if uf not in config["names"]:
            raise DataError(f"{path.name}: unknown state {uf!r}")
        entry: dict = {
            "uf": uf,
            "name": config["names"][uf],
            "note": config["notes"].get(uf, ""),
            "governor": {},
            "senate": {},
        }
        for race, (office, round_id) in RACES.items():
            if source.get(race):
                # Official results so far: the 1st round, governor and Senate.
                official = results[office][uf]["candidates"] if results and round_id == "r1" else None
                built = build_race(uf, race, source[race], config, round_dates[round_id], pollsters, official)
                if built:
                    entry[office][round_id] = built
        out[uf] = entry
    return out
