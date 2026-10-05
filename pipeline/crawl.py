"""Looks for polls that are missing from the dataset.

    npm run crawler                 # add new polls, report the rest
    npm run crawler -- --dry-run    # report only, change nothing

Two sources, used for different things:

- Wikipedia poll tables have the numbers. New presidential polls found there
  are appended to data/raw/presidential/<year>-<round>.csv, and new governor
  and Senate polls from the Portuguese state pages to data/raw/states/<UF>.json.
  Polls already in the dataset are compared, so transcription disagreements
  surface.
- The TSE registry lists every registered poll but not its results. It is the
  checklist: published polls from known pollsters that are still missing,
  national or per state, so they can be looked up and added by hand.

Every change lands in files tracked by git: review it with `git diff`.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import yaml

from .build import DATA, OUTPUT, build_dataset, serialize
from .polls import OTHERS, ROUNDING_SLACK, SPECIAL_SERIES, UNDECIDED, DataError
from .pollsters import PollsterRegistry
from .sources import tse_registry, wikipedia
from .states import RACES

RAW = DATA / "raw" / "presidential"
STATES_RAW = DATA / "raw" / "states"
TSE_CACHE = DATA / "raw" / "tse"
ROUND_TITLES = {"r1": "First round", "r2": "Second round"}
# The same poll can carry dates a day apart in different sources.
SAME_POLL_DAYS = 1
# Registered polls are matched more loosely: the registry has planned dates.
REGISTRY_MATCH_DAYS = 2
# Values further apart than this (points) are reported as a disagreement.
DISAGREEMENT_POINTS = 1.0


@dataclass
class RoundReport:
    added: list[dict] = field(default_factory=list)
    # Added polls without a matching TSE registration (shown so they get a look).
    unconfirmed: list[str] = field(default_factory=list)
    review: list[str] = field(default_factory=list)
    disagreements: list[str] = field(default_factory=list)


def registered(
    registrations: list[tse_registry.Registration] | None,
    pollsters: PollsterRegistry,
    pollster: str,
    end: date,
    office: str,
    scopes: tuple[str | None, ...],
) -> bool | None:
    """Whether the TSE registry has this poll; None when the registry was not loaded."""
    if registrations is None:
        return None
    return any(
        office in r.offices
        and r.scope in scopes
        and pollsters.normalize(r.pollster) == pollster
        and abs((r.end - end).days) <= REGISTRY_MATCH_DAYS
        for r in registrations
    )


# --- Wikipedia → presidential CSVs -------------------------------------------------


def column_series(header: str, aliases: dict[str, str]) -> str | None:
    """Maps a Wikipedia column ("F. Bolsonaro PL") to a series of ours ("Flávio")."""
    for alias, series in aliases.items():
        if header == alias or header.startswith(alias + " "):
            return series
    low = header.lower()
    if "blank" in low or "undec" in low or low.startswith(("indecis", "branco", "nulo")):
        return UNDECIDED
    if low.startswith(("others", "outros")):
        return OTHERS
    return None


def pick_scenario(
    poll: wikipedia.WikiPoll, aliases: dict[str, str], candidates: list[str], runoff: bool
) -> dict[str, float] | None:
    """The scenario matching our race: all our candidates the poll tested and,
    for a runoff, nobody else."""

    def named(values: dict[str, float]) -> dict[str, str]:
        return {h: s for h in values if (s := column_series(h, aliases)) not in SPECIAL_SERIES}

    tested = {s for sc in poll.scenarios for s in named(sc.values).values() if s in candidates}
    for sc in poll.scenarios:
        present = named(sc.values)
        ours = {s for s in present.values() if s in candidates}
        if not tested or ours != tested:
            continue
        if runoff and any(s is None for s in present.values()):
            continue
        return sc.values
    return None


def to_series(values: dict[str, float], aliases: dict[str, str], series: list[str]) -> dict[str, float]:
    """Our columns from a Wikipedia scenario; untracked candidates go to "others"."""
    out: dict[str, float] = {}
    others = 0.0
    has_others = False
    for header, v in values.items():
        s = column_series(header, aliases)
        if s in series and s != OTHERS:
            out[s] = v
        elif s is None or s == OTHERS:
            others += v
            has_others = True
    if OTHERS in series and has_others:
        out[OTHERS] = round(others, 1)
    return out


def format_number(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(round(v, 2))


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_rows(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    rows = sorted(rows, key=lambda r: r["date"])  # stable: same-day rows keep their order
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def find_match(rows: list[dict[str, str]], pollster: str, end: date, days: int) -> dict[str, str] | None:
    for r in rows:
        if r["pollster"] == pollster and abs((date.fromisoformat(r["date"]) - end).days) <= days:
            return r
    return None


def crawl_round(
    year: int,
    round_id: str,
    election: dict,
    pollsters: PollsterRegistry,
    wiki_polls: list[wikipedia.WikiPoll],
    registrations: list[tse_registry.Registration] | None,
    dry_run: bool,
) -> RoundReport:
    """Appends Wikipedia polls missing from the round's CSV.

    A new poll is added when the TSE registry confirms it, or when its pollster
    already has polls in this race. A pollster we have never seen, with no TSE
    registration either, is left for a human to check.
    """
    report = RoundReport()
    spec = election["rounds"][round_id]
    path = RAW / f"{year}-{round_id}.csv"
    header, rows = read_rows(path)
    series = header[3:]
    candidates = [s for s in series if s not in SPECIAL_SERIES]
    aliases = {meta.get("wikipedia", name): name for name, meta in election["candidates"].items()}
    skipped = {(p, str(d)) for p, d, *_ in spec.get("skip_polls", [])}
    election_day: date = spec["date"]
    runoff = round_id == "r2"
    established = {r["pollster"] for r in rows}

    for wp in wiki_polls:
        pollster = pollsters.normalize(wp.pollster)
        label = f"{pollster} {wp.end_date:%d/%m} ({wp.period})"
        if not date(year, 1, 1) <= wp.end_date < election_day or (pollster, str(wp.end_date)) in skipped:
            continue
        values = pick_scenario(wp, aliases, candidates, runoff)
        existing = find_match(rows, pollster, wp.end_date, SAME_POLL_DAYS)
        if existing:
            if values:
                ours = to_series(values, aliases, series)
                diffs = [
                    f"{s} {existing[s] or '—'} × {format_number(v)}"
                    for s, v in ours.items()
                    if s in candidates
                    and existing.get(s)
                    and abs(float(existing[s]) - v) > DISAGREEMENT_POINTS
                ]
                if diffs:
                    report.disagreements.append(f"{label}: dataset × Wikipedia: {', '.join(diffs)}")
            continue
        if values is None:
            report.review.append(f"{label}: no scenario with the expected candidates")
            continue
        ours = to_series(values, aliases, series)
        if UNDECIDED in series and UNDECIDED not in ours:
            report.review.append(f"{label}: no blank/undecided column, possibly valid votes only")
            continue
        if sum(ours.values()) > 100 + ROUNDING_SLACK * len(ours):
            report.review.append(f"{label}: values add up to {sum(ours.values()):.1f}%")
            continue
        confirmed = registered(registrations, pollsters, pollster, wp.end_date, "president", ("BR", None))
        if confirmed is False and pollster not in established:
            report.review.append(f"{label}: new pollster and no TSE registration found")
            continue
        if confirmed is False:
            report.unconfirmed.append(label)
        row = {
            "pollster": pollster,
            "date": wp.end_date.isoformat(),
            "sample_size": str(wp.sample_size or ""),
        }
        row.update({s: format_number(ours[s]) if s in ours else "" for s in series})
        rows.append(row)
        report.added.append(row)

    if report.added and not dry_run:
        write_rows(path, header, rows)
    return report


# --- Wikipedia (pt) → state JSON files ---------------------------------------------

STATE_PAGE = "Pesquisas eleitorais para a eleição {kind} de {year} {prep} {name}"
STATE_PAGE_PREPOSITIONS = ("em", "no", "na")
# Which top-level section of a state page holds each race ("Senado" in some states).
RACE_SECTIONS = {"governor_r1": "primeiro turno", "governor_r2": "segundo turno", "senate_r1": "senad"}
RACE_OFFICES = {"governor_r1": "governor", "governor_r2": "governor", "senate_r1": "senate"}
# Words that do not tell candidates apart: "Professora Dorinha" is not "Professora Maria do Carmo".
NAME_FILLERS = {
    "de", "da", "do", "dos", "das", "dr", "dra", "doutor", "doutora", "professor", "professora",
    "delegado", "delegada", "capitao", "coronel", "pastor", "pastora", "soldado", "sargento",
    "general", "tenente", "major", "cabo", "deputado", "deputada", "senador", "senadora",
    "prefeito", "prefeita", "padre", "irmao", "irma", "policial", "filho", "neto", "junior",
}  # fmt: skip
# Candidates below this share (points) in our latest poll may be folded into
# "Outros" on the page; anyone above it must be in a scenario for it to be ours.
REQUIRED_SHARE = 5
# "Ricardo Ferraço ( MDB )" or "Tarcísio REPUBLICANOS".
PARTY_IN_PARENS = re.compile(r"^(.*?)\s*\(\s*([^)]*?)\s*\)\s*$")


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def state_page_titles(names: dict[str, str], year: int) -> dict[str, list[str]]:
    """Titles a state's poll page may have; the Federal District's election is "distrital"."""
    return {
        uf: [
            STATE_PAGE.format(kind="distrital" if uf == "DF" else "estadual", year=year, prep=prep, name=name)
            for prep in STATE_PAGE_PREPOSITIONS
        ]
        for uf, name in names.items()
    }


def split_header(header: str) -> tuple[str, str]:
    """(name, party) of a candidate column."""
    if m := PARTY_IN_PARENS.match(header):
        return m.group(1), m.group(2)
    words = header.split()
    if len(words) > 1 and words[-1].isupper():
        return " ".join(words[:-1]), words[-1]
    return header, ""


def name_words(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", _ascii(name)) if len(w) > 1 and w not in NAME_FILLERS}


def same_party(a: str, b: str) -> bool:
    """ "UNIÃO" and "União Brasil", "PODE" and "Podemos"."""
    a, b = _ascii(a).split()[:1], _ascii(b).split()[:1]
    return bool(a and b) and (a[0].startswith(b[0]) or b[0].startswith(a[0]))


def match_candidate(header: str, candidates: dict[str, str], aliases: dict[str, str]) -> str | None:
    """Our name for a Wikipedia column: an explicit alias, or a shared name word.

    One shared word is enough only with the same party: "Toni Rodrigues (PL)" is
    not "Joel Rodrigues (PP)".
    """
    name, party = split_header(header)
    if name in aliases:
        return aliases[name]
    words = name_words(name)
    hits = [
        c
        for c in candidates
        if len(shared := name_words(c) & words) > 1
        or (shared and (same_party(party, candidates[c]) or not party))
    ]
    return hits[0] if len(hits) == 1 else None


def resolve_pollster(
    raw: str,
    uf: str,
    end: date,
    office: str,
    pollsters: PollsterRegistry,
    registrations: list[tse_registry.Registration] | None,
) -> str:
    """Canonical pollster name, with the TSE registry settling short names.

    The pages write "Vox" for Vox Brasil and Vox Populi alike: when the name
    alone has no registration, a registered poll of the same state and dates
    whose pollster starts with one of the written names is taken instead.
    """
    name = pollsters.normalize(raw)
    if registered(registrations, pollsters, name, end, office, (uf,)) is not False:
        return name
    written = [_ascii(part).strip() for part in raw.split("/") if part.strip()]
    near = {
        pollsters.normalize(r.pollster)
        for r in registrations or []
        if r.scope == uf and office in r.offices and abs((r.end - end).days) <= REGISTRY_MATCH_DAYS
    }
    hits = {n for n in near if any(_ascii(n).startswith(w) for w in written)}
    return hits.pop() if len(hits) == 1 else name


@dataclass
class StateReport:
    added: list[str] = field(default_factory=list)
    unconfirmed: list[str] = field(default_factory=list)
    review: list[str] = field(default_factory=list)
    disagreements: list[str] = field(default_factory=list)
    # Polls from local institutes we do not follow.
    not_followed: int = 0
    # Polls older than the race's latest one that we do not have: left to the maintainer.
    older: int = 0
    # (UF, pollster, end date) of the polls added, for the registry checklist.
    pending: set[tuple[str, str, date]] = field(default_factory=set)


def to_number(v: float) -> int | float:
    return int(v) if float(v).is_integer() else round(v, 2)


def crawl_state_race(
    uf: str,
    race: str,
    source: dict,
    wiki_polls: list[wikipedia.WikiPoll],
    window: tuple[date, date],
    excluded: set[tuple[str, str, str, str]],
    pollsters: PollsterRegistry,
    registrations: list[tse_registry.Registration] | None,
    report: StateReport,
) -> bool:
    """Adds the race's new polls to `source`; True when something was added.

    Only polls after the latest one in the file are added: older polls missing
    from it may have been left out on purpose, so they are only counted. Same
    rule as the presidential polls: the TSE registry confirms the poll, or its
    pollster already polls this state. Runoff polls count only for the matchup
    the file follows, and Senate polls only when they add up to about 100% (the
    raw sum of two votes is on another scale, see SPEC.md).
    """
    block = source[race]
    office = RACE_OFFICES[race]
    runoff = race == "governor_r2"
    candidates = list(block.get("matchup") or []) if runoff else list(block["candidates"])
    series = [*candidates, *([] if runoff else [OTHERS]), UNDECIDED]
    headers = {h for wp in wiki_polls for sc in wp.scenarios for h in sc.values}
    aliases = {
        h: name
        for h in headers
        if column_series(h, {}) is None
        and (name := match_candidate(h, block["candidates"], block.get("wikipedia", {}))) in candidates
    }
    rows = block["polls"]
    # Leading candidates of the latest poll we have: a scenario without one of them is not our race.
    latest = max(rows, key=lambda r: r["date"], default=None)
    since = date.fromisoformat(latest["date"]) if latest else window[0]
    required = {c for c, v in (latest or {}).get("v", {}).items() if c in candidates and v >= REQUIRED_SHARE}
    established = {pollsters.normalize(p["p"]) for r in RACES if source.get(r) for p in source[r]["polls"]}
    added = False

    for wp in wiki_polls:
        if not window[0] <= wp.end_date <= window[1]:
            continue
        pollster = resolve_pollster(wp.pollster, uf, wp.end_date, office, pollsters, registrations)
        label = f"{uf} {race} · {pollster} {wp.end_date:%d/%m}"
        if (uf, race, pollster, str(wp.end_date)) in excluded:
            continue
        existing = next(
            (
                r
                for r in rows
                if pollsters.normalize(r["p"]) == pollster
                and abs((date.fromisoformat(r["date"]) - wp.end_date).days) <= SAME_POLL_DAYS
            ),
            None,
        )
        values = pick_scenario(wp, aliases, candidates, runoff)
        tested = {aliases.get(h) for sc in wp.scenarios for h in sc.values} & set(candidates)
        if runoff and tested != set(candidates):
            continue  # another matchup
        if existing:
            if values:
                ours = to_series(values, aliases, series)
                diffs = [
                    f"{s} {existing['v'][s]} × {format_number(v)}"
                    for s, v in ours.items()
                    if s in candidates
                    and s in existing["v"]
                    and abs(float(existing["v"][s]) - v) > DISAGREEMENT_POINTS
                ]
                if diffs:
                    report.disagreements.append(f"{label}: dataset × Wikipedia: {', '.join(diffs)}")
            continue
        if not pollsters.is_known(pollster) and pollster not in established:
            report.not_followed += 1
            continue
        if wp.end_date <= since:
            report.older += 1
            continue
        if values is None:
            report.review.append(f"{label}: no scenario with the expected candidates")
            continue
        ours = to_series(values, aliases, series)
        if missing := required - set(ours):
            report.review.append(f"{label}: missing {', '.join(sorted(missing))} (left the race?)")
            continue
        if UNDECIDED not in ours:
            report.review.append(f"{label}: no blank/undecided column, possibly valid votes only")
            continue
        total = sum(ours.values())
        if total > 100 + ROUNDING_SLACK * len(ours):
            why = "raw sum of the two Senate votes" if office == "senate" else "values"
            report.review.append(f"{label}: {why} add up to {total:.1f}%")
            continue
        confirmed = registered(registrations, pollsters, pollster, wp.end_date, office, (uf,))
        if confirmed is False and pollster not in established:
            report.review.append(f"{label}: new pollster and no TSE registration found")
            continue
        if confirmed is False:
            report.unconfirmed.append(label)
        poll = {
            "p": pollster,
            "date": wp.end_date.isoformat(),
            "n": wp.sample_size,
            "method": pollsters.methods().get(pollster, ""),
            "v": {s: to_number(ours[s]) for s in series if s in ours},
        }
        rows.append(poll)
        added = True
        report.pending.add((uf, pollster, wp.end_date))
        values_text = " ".join(f"{k}={v}" for k, v in poll["v"].items())
        report.added.append(f"{label} n={wp.sample_size or '?'} {values_text}")

    rows.sort(key=lambda r: r["date"])  # stable: same-day rows keep their order
    return added


def dump_state(source: dict) -> str:
    """The layout of data/raw/states/*.json: one poll (and one source) per line."""

    def entry(key: str, value, indent: int) -> str:
        pad = " " * indent
        if isinstance(value, dict) and "polls" in value:
            body = ",\n".join(entry(k, v, indent + 2) for k, v in value.items())
            return f"{pad}{json.dumps(key, ensure_ascii=False)}: {{\n{body}\n{pad}}}"
        if key in ("polls", "sources") and value:
            body = ",\n".join(f"{pad}  {json.dumps(x, ensure_ascii=False)}" for x in value)
            return f"{pad}{json.dumps(key, ensure_ascii=False)}: [\n{body}\n{pad}]"
        return f"{pad}{json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)}"

    return "{\n" + ",\n".join(entry(k, v, 2) for k, v in source.items()) + "\n}\n"


def crawl_states(
    config: dict,
    pollsters: PollsterRegistry,
    registrations: list[tse_registry.Registration] | None,
    dry_run: bool,
) -> StateReport:
    """Adds the governor and Senate polls missing from data/raw/states/<UF>.json."""
    year = config["year"]
    window = (config["poll_window"]["start"], config["poll_window"]["end"])
    excluded = {(u, r, p, str(d)) for u, r, p, d in config["excluded_polls"]}
    titles = wikipedia.existing_titles(
        [t for ts in state_page_titles(config["names"], year).values() for t in ts], "pt"
    )
    report = StateReport()
    for uf, candidates in state_page_titles(config["names"], year).items():
        path = STATES_RAW / f"{uf}.json"
        title = next((t for t in candidates if t in titles), None)
        if not path.exists():
            continue
        if title is None:
            report.review.append(f"{uf}: no Wikipedia page found ({candidates[0]})")
            continue
        page = wikipedia.page_html(title, "pt") or ""
        sections = wikipedia.split_sections(page)
        source = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for race in RACES:
            if not source.get(race):
                continue
            body = "".join(h for name, h in sections if RACE_SECTIONS[race] in name.lower())
            polls = wikipedia.parse_polls(body, year, decimal_comma=True)
            changed |= crawl_state_race(
                uf, race, source, polls, window, excluded, pollsters, registrations, report
            )
        url = f"https://pt.wikipedia.org/wiki/{title.replace(' ', '_')}"
        if changed and not dry_run:
            if url not in source.setdefault("sources", []):
                source["sources"].append(url)
            path.write_text(dump_state(source), encoding="utf-8")
    return report


# --- TSE registry → checklist ------------------------------------------------------


def dataset_polls(dataset: dict) -> tuple[set[tuple[str, date]], dict[str, set[tuple[str, date]]]]:
    """(pollster, end date) of every poll we have, nationally and per state."""

    def keys(races, year: int) -> set[tuple[str, date]]:
        return {(p["p"], date(year, 1, 1) + timedelta(days=p["d"])) for r in races for p in r["polls"]}

    national = set()
    for election in dataset["presidential"].values():
        national |= keys(election["rounds"].values(), election["year"])
    states = {}
    for uf, st in dataset["states"].items():
        races = [*st["governor"].values(), *st["senate"].values()]
        year = int(races[0]["date"][:4]) if races else 0
        states[uf] = keys(races, year) if races else set()
    return national, states


def has_poll(have: set[tuple[str, date]], pollster: str, end: date) -> bool:
    return any(p == pollster and abs((d - end).days) <= REGISTRY_MATCH_DAYS for p, d in have)


@dataclass(frozen=True)
class Missing:
    office: str  # "Presidente", "Governador/Senador"...
    scope: str  # "BR" or a state code
    pollster: str
    end: date
    release: date
    sample_size: int | None
    protocol: str

    def line(self) -> str:
        where = "" if self.scope == "BR" else f" {self.scope}"
        return (
            f"{self.office}{where} · {self.pollster} · campo até {self.end:%d/%m}, "
            f"divulgada {self.release:%d/%m}, n={self.sample_size or '?'} · {self.protocol}"
        )


@dataclass
class Checklist:
    national: list[Missing] = field(default_factory=list)
    states: list[Missing] = field(default_factory=list)
    # National or state? The registry does not say: pollster → end dates.
    unclear: dict[str, list[date]] = field(default_factory=dict)
    upcoming: list[Missing] = field(default_factory=list)


def office_label(offices: frozenset[str]) -> str:
    names = [
        n
        for n, k in (("Presidente", "president"), ("Governador", "governor"), ("Senador", "senate"))
        if k in offices
    ]
    return "/".join(names)


def registry_checklist(
    registrations: list[tse_registry.Registration],
    dataset: dict,
    pollsters: PollsterRegistry,
    today: date,
    pending: set[tuple[str, date]] = frozenset(),
    pending_states: set[tuple[str, str, date]] = frozenset(),
) -> Checklist:
    """Registered polls from pollsters we follow that are not in the dataset.

    `pending` and `pending_states` hold national and (UF, ...) state polls about
    to be added (a dry run), so they are not reported as missing.
    """
    national, states = dataset_polls(dataset)
    national = national | set(pending)
    for uf, pollster, end in pending_states:
        states[uf] = states.get(uf, set()) | {(pollster, end)}
    state_pollsters = {uf: {p for p, _ in polls} for uf, polls in states.items()}
    out = Checklist()
    seen: set[tuple[str, str, date]] = set()
    for r in sorted(registrations, key=lambda r: (r.end, r.pollster)):
        name = pollsters.normalize(r.pollster)
        if "president" in r.offices and r.scope in ("BR", None) and pollsters.is_known(r.pollster):
            scope, have = "BR", national
            offices = frozenset({"president"})
        elif r.offices & {"governor", "senate"} and r.scope in states:
            if not (pollsters.is_known(r.pollster) or name in state_pollsters[r.scope]):
                continue
            scope, have = r.scope, states[r.scope]
            offices = r.offices & {"governor", "senate"}
        else:
            continue
        if has_poll(have, name, r.end) or (name, scope, r.end) in seen:
            continue
        seen.add((name, scope, r.end))
        item = Missing(office_label(offices), scope, name, r.end, r.release, r.sample_size, r.protocol)
        if r.release > today or r.end > today:  # planned dates
            out.upcoming.append(item)
        elif scope == "BR" and r.scope is None:
            out.unclear.setdefault(name, []).append(r.end)
        elif scope == "BR":
            out.national.append(item)
        else:
            out.states.append(item)
    return out


def summarize_states(items: list[Missing]) -> list[str]:
    by_state: dict[str, list[Missing]] = {}
    for m in items:
        by_state.setdefault(m.scope, []).append(m)
    lines = []
    for uf, ms in sorted(by_state.items(), key=lambda kv: -len(kv[1])):
        counts: dict[str, int] = {}
        for m in ms:
            counts[m.pollster] = counts.get(m.pollster, 0) + 1
        who = ", ".join(f"{p} {n}" for p, n in sorted(counts.items(), key=lambda kv: -kv[1]))
        lines.append(f"{uf}: {len(ms)} · last {max(m.end for m in ms):%d/%m} · {who}")
    return lines


# --- CLI ---------------------------------------------------------------------------


def describe_row(row: dict[str, str]) -> str:
    values = " ".join(f"{k}={v}" for k, v in list(row.items())[3:] if v)
    return f"{row['pollster']} {row['date']} n={row['sample_size'] or '?'} {values}"


def print_section(title: str, lines: list[str], limit: int = 40) -> None:
    if not lines:
        return
    print(f"\n{title} ({len(lines)})")
    for line in lines[:limit]:
        print(f"  {line}")
    if len(lines) > limit:
        print(f"  … and {len(lines) - limit} more")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="report only, do not change any file")
    parser.add_argument("--no-wikipedia", action="store_true", help="skip Wikipedia")
    parser.add_argument("--no-tse", action="store_true", help="skip the TSE registry")
    parser.add_argument("--no-states", action="store_true", help="skip the governor and Senate polls")
    parser.add_argument("--details", action="store_true", help="list every missing state poll")
    args = parser.parse_args()

    elections = yaml.safe_load((DATA / "elections.yaml").read_text(encoding="utf-8"))
    states_config = yaml.safe_load((DATA / "states.yaml").read_text(encoding="utf-8"))
    pollsters = PollsterRegistry.load(DATA / "pollsters.yaml")
    year = int(max(elections))
    election = elections[str(year)]
    today = date.today()

    registrations = None
    if not args.no_tse:
        print("TSE registry: downloading…", end=" ", flush=True)
        archive = tse_registry.download(year, TSE_CACHE)
        registrations = tse_registry.read_registrations(archive, states_config["names"])
        print(f"{len(registrations)} registrations for president, governor or senate")

    added = 0
    pending: set[tuple[str, date]] = set()
    if not args.no_wikipedia and election.get("wikipedia"):
        print(f"Wikipedia: {election['wikipedia']}")
        for round_id in election["rounds"]:
            wiki = wikipedia.fetch_polls(election["wikipedia"], ROUND_TITLES[round_id], year)
            report = crawl_round(year, round_id, election, pollsters, wiki, registrations, args.dry_run)
            added += len(report.added)
            pending |= {(r["pollster"], date.fromisoformat(r["date"])) for r in report.added}
            verb = "would add" if args.dry_run else "added"
            print(f"  {round_id}: {len(wiki)} polls on the page, {verb} {len(report.added)}")
            print_section(f"New polls, {round_id}", [describe_row(r) for r in report.added])
            print_section(f"Added without a TSE registration, worth a look, {round_id}", report.unconfirmed)
            print_section(f"Need a human look, {round_id}", report.review)
            print_section(f"Dataset and Wikipedia disagree, {round_id}", report.disagreements)

    pending_states: set[tuple[str, str, date]] = set()
    if not args.no_wikipedia and not args.no_states:
        print("\nWikipedia (pt): governor and Senate pages, one per state…", flush=True)
        st = crawl_states(states_config, pollsters, registrations, args.dry_run)
        added += len(st.added)
        pending_states = st.pending
        verb = "would add" if args.dry_run else "added"
        print(f"  {verb} {len(st.added)} state polls")
        print_section("New state polls", st.added, limit=200)
        print_section("Added without a TSE registration, worth a look", st.unconfirmed)
        print_section("Need a human look", st.review, limit=200 if args.details else 40)
        print_section("Dataset and Wikipedia disagree", st.disagreements, limit=200 if args.details else 40)
        if st.not_followed:
            print(f"\n  {st.not_followed} polls from local institutes we do not follow were left out")
        if st.older:
            print(f"  {st.older} polls older than the latest one of their race are not in the files")

    try:
        dataset = build_dataset()
    except DataError as e:
        print(f"\nerror: the new rows break validation: {e}", file=sys.stderr)
        print("Fix the row or revert with `git checkout data/raw`.", file=sys.stderr)
        return 1
    if added and not args.dry_run:
        OUTPUT.write_text(serialize(dataset), encoding="utf-8")
        print(f"\nRebuilt {OUTPUT.relative_to(DATA.parent)}. Review with `git diff data/raw`.")

    if registrations is not None:
        check = registry_checklist(registrations, dataset, pollsters, today, pending, pending_states)
        print("\nTSE registry: released polls from pollsters we follow that are not in the dataset")
        print_section("President, national sample", [m.line() for m in check.national])
        print_section(
            "President, scope not stated (may be state samples)",
            [
                f"{p}: {len(ds)} · {min(ds):%d/%m}–{max(ds):%d/%m}"
                for p, ds in sorted(check.unclear.items(), key=lambda kv: -len(kv[1]))
            ],
        )
        window_end = states_config["poll_window"]["end"]
        print_section(
            f"Governor/Senate by state (poll window ends {window_end:%d/%m}, see data/states.yaml)",
            [m.line() for m in check.states] if args.details else summarize_states(check.states),
            limit=200 if args.details else 40,
        )
        print_section(
            "Registered, release date still ahead",
            [m.line().replace("divulgada", "divulga em") for m in check.upcoming if m.scope == "BR"]
            + (
                [f"+ {sum(m.scope != 'BR' for m in check.upcoming)} state polls"]
                if any(m.scope != "BR" for m in check.upcoming)
                else []
            ),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
