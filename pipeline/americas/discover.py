"""Drafts data/americas/elections.yaml from Wikipedia: one entry per national election.

    uv run python -m pipeline.americas.discover

For each country, lists the election articles linked from "Elections in <country>"
and reads the first election infobox: date, winner and winner's party. The
output is a draft to review by hand; entries marked `review:` need a look.
Wikitext is cached in data/raw/americas/cache/.
"""

from __future__ import annotations

import re
import sys
import time
from datetime import date
from pathlib import Path

import yaml

from ..build import DATA
from ..sources.http import get_json
from .wikitext import find_template, link_target, plain, template_params

API = "https://en.wikipedia.org/w/api.php"
CACHE = DATA / "raw" / "americas" / "cache"
OUTPUT = DATA / "americas" / "elections.yaml"
CORRECTIONS = DATA / "americas" / "corrections.yaml"
FIRST_YEAR = 2000

# Country → how it is named in "Elections in …" and how the head of government is chosen.
COUNTRIES: dict[str, tuple[str, str]] = {
    "ARG": ("Argentina", "presidential"),
    "BOL": ("Bolivia", "presidential"),
    "BRA": ("Brazil", "presidential"),
    "CHL": ("Chile", "presidential"),
    "COL": ("Colombia", "presidential"),
    "CRI": ("Costa Rica", "presidential"),
    "DOM": ("the Dominican Republic", "presidential"),
    "ECU": ("Ecuador", "presidential"),
    "GTM": ("Guatemala", "presidential"),
    "HND": ("Honduras", "presidential"),
    "HTI": ("Haiti", "presidential"),
    "MEX": ("Mexico", "presidential"),
    "NIC": ("Nicaragua", "presidential"),
    "PAN": ("Panama", "presidential"),
    "PER": ("Peru", "presidential"),
    "PRY": ("Paraguay", "presidential"),
    "SLV": ("El Salvador", "presidential"),
    "URY": ("Uruguay", "presidential"),
    "USA": ("the United States", "presidential"),
    "VEN": ("Venezuela", "presidential"),
    # The president comes from the winning list in the general election.
    "GUY": ("Guyana", "general"),
    "SUR": ("Suriname", "general"),
    # Parliamentary: the party that wins the general election forms the government.
    "ATG": ("Antigua and Barbuda", "parliamentary"),
    "BHS": ("the Bahamas", "parliamentary"),
    "BLZ": ("Belize", "parliamentary"),
    "BRB": ("Barbados", "parliamentary"),
    "CAN": ("Canada", "parliamentary"),
    "DMA": ("Dominica", "parliamentary"),
    "GRD": ("Grenada", "parliamentary"),
    "JAM": ("Jamaica", "parliamentary"),
    "KNA": ("Saint Kitts and Nevis", "parliamentary"),
    "LCA": ("Saint Lucia", "parliamentary"),
    "TTO": ("Trinidad and Tobago", "parliamentary"),
    "VCT": ("Saint Vincent and the Grenadines", "parliamentary"),
}
# Titles that match the pattern but are not national elections that pick a government.
EXCLUDE = re.compile(
    r"Ontario|Quebec|Alberta|British Columbia|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|"
    r"Newfoundland|Prince Edward|Yukon|Northwest Territories|Nunavut|"
    r"Barbadian presidential|Trinidad and Tobago presidential|vice presidential"
)
TITLE = re.compile(r"^(\d{4})(?:[–-]\d{2,4})? .*(presidential|general|federal) election$", re.I)
MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ],
        start=1,
    )
}


def cache_path(title: str) -> Path:
    return CACHE / (re.sub(r"[^\w-]+", "_", title) + ".wiki")


def fetch(title: str) -> tuple[str, str]:
    """(article title after redirects, wikitext); cached."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = cache_path(title)
    if not path.exists():
        d = get_json(
            API,
            {
                "action": "parse",
                "page": title,
                "prop": "wikitext",
                "format": "json",
                "formatversion": 2,
                "redirects": 1,
            },
        )
        if "parse" not in d:
            raise KeyError(f"{title}: {d.get('error', {}).get('info', 'no such page')}")
        path.write_text(d["parse"]["title"] + "\n" + d["parse"]["wikitext"], encoding="utf-8")
        time.sleep(0.2)
    resolved, _, text = path.read_text(encoding="utf-8").partition("\n")
    return resolved, text


def wikitext(title: str) -> str:
    return fetch(title)[1]


def election_titles(country_name: str) -> list[str]:
    titles, cont = [], {}
    while True:
        d = get_json(
            API,
            {
                "action": "query",
                "titles": f"Elections in {country_name}",
                "prop": "links",
                "pllimit": "max",
                "format": "json",
                "redirects": 1,
                **cont,
            },
        )
        for page in d["query"]["pages"].values():
            titles += [link["title"] for link in page.get("links", [])]
        if "continue" not in d:
            break
        cont = d["continue"]
    return sorted(
        {
            t
            for t in titles
            if (m := TITLE.match(t))
            and FIRST_YEAR <= int(m.group(1)) <= date.today().year
            and not EXCLUDE.search(t)
        }
    )


def probe_titles(found: list[str]) -> list[str]:
    """Articles following the same naming as the ones found ("2008 Canadian federal
    election" from "2006 Canadian federal election"), for years the list page missed."""
    suffixes = {re.sub(r"^\d{4}(?:[–-]\d{2,4})? ", "", t) for t in found}
    candidates = [f"{y} {s}" for s in suffixes for y in range(FIRST_YEAR, date.today().year + 1)]
    candidates = [c for c in candidates if c not in found]
    existing = []
    for i in range(0, len(candidates), 50):
        d = get_json(API, {"action": "query", "titles": "|".join(candidates[i : i + 50]), "format": "json"})
        existing += [p["title"] for p in d["query"]["pages"].values() if "missing" not in p]
    return existing


def parse_date(value: str) -> str | None:
    text = plain(value)
    if m := re.search(r"(\d{4})\|(\d{1,2})\|(\d{1,2})", value):  # {{Start date|2024|6|2}}
        return f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}"
    if m := re.search(r"(\d{1,2}) (" + "|".join(MONTHS) + r") (\d{4})", text):
        return f"{m[3]}-{MONTHS[m[2]]:02d}-{int(m[1]):02d}"
    if m := re.search(r"(" + "|".join(MONTHS) + r") (\d{1,2}),? (\d{4})", text):
        return f"{m[3]}-{MONTHS[m[1]]:02d}-{int(m[2]):02d}"
    return None


def infoboxes(text: str) -> list[dict[str, str]]:
    """Every election infobox, including those embedded in another's `module`."""
    boxes = []
    for m in re.finditer(r"\{\{\s*Infobox (?:legislative )?election", text, re.I):
        span = find_template(text, "Infobox", m.start())
        if span and span[0] == m.start():
            boxes.append(template_params(text[span[0] : span[1]]))
    return boxes


def candidates(box: dict[str, str]) -> list[dict]:
    """Everyone the infobox lists for the race: name, party (as shown and its article)."""
    out = []
    for n in range(1, 13):
        name = box.get(f"nominee{n}") or box.get(f"candidate{n}") or box.get(f"leader{n}")
        if not name:
            continue
        party, alliance = box.get(f"party{n}", ""), box.get(f"alliance{n}", "")
        c = {
            "name": plain(name),
            "party": plain(party) or None,
            "party_article": link_target(party)
            or (plain(party) if party and "[[" not in party and "{{" not in party else None),
        }
        if plain(alliance):
            c["alliance"] = plain(alliance)
            c["alliance_article"] = link_target(alliance)
        out.append(c)
    return out


def read_infobox(text: str, system: str) -> dict:
    """Date, who took office and their party, from the election infoboxes.

    `after_election`/`after_party` name the office holder after the election, which
    is what the map shows. The first-listed candidate is not enough: it follows the
    first round (Menem in Argentina 2003, who then withdrew) or the largest party
    rather than the governing coalition. General-election articles nest one infobox
    per race; the one for the race that picks the government is preferred.
    """
    boxes = infoboxes(text)
    if not boxes:
        return {"review": "no election infobox"}
    keys = ("leader1",) if system == "parliamentary" else ("nominee1", "candidate1")
    race = next((b for b in boxes if any(b.get(k) for k in keys)), None) or next(
        (b for b in boxes if b.get("leader1") or b.get("nominee1") or b.get("candidate1")), {}
    )
    # Only when the office is the head of government: some legislative infoboxes
    # name the Speaker there (Suriname 2000–2015).
    head = re.compile(r"President|Prime Minister|Premier", re.I)
    after = next(
        (
            b
            for b in boxes
            if b.get("after_election") and head.search(plain(b.get("title", "")) or "President")
        ),
        None,
    )
    when = race.get("election_date") or next(
        (b["election_date"] for b in boxes if b.get("election_date")), ""
    )
    out: dict = {"date": parse_date(when)}
    if after:
        winner_raw, party_raw = after["after_election"], after.get("after_party", "")
    else:
        winner_raw = race.get("nominee1") or race.get("candidate1") or race.get("leader1") or ""
        party_raw = race.get("party1", "")
        out["review"] = "no after_election: winner taken from the first-listed candidate"
    winner = plain(winner_raw)
    if re.search(r"annul", winner, re.I):
        out["status"] = "annulled"
    elif re.search(r"disputed|contested", winner, re.I):
        out["status"] = "disputed"
        winner = re.sub(r"\s*\((disputed|contested)\)?", "", winner, flags=re.I).strip()
    out["winner"] = winner
    out["party"] = plain(party_raw) or None
    out["party_article"] = link_target(party_raw) or (
        plain(party_raw) if party_raw and "[[" not in party_raw and "{{" not in party_raw else None
    )
    out["candidates"] = candidates(race)
    if out.get("status") != "annulled" and (not out["winner"] or not out["party"] or not out["date"]):
        out["review"] = "date, winner or party missing in the infobox"
    return out


def main() -> int:
    corrections = yaml.safe_load(CORRECTIONS.read_text(encoding="utf-8"))
    drop, fixes = set(corrections.get("drop") or []), corrections.get("set") or {}
    draft: dict = {}
    for iso, (name, system) in COUNTRIES.items():
        entries = []
        titles = election_titles(name)
        titles = sorted(set(titles) | {t for t in probe_titles(titles) if not EXCLUDE.search(t)})
        titles += (corrections.get("add") or {}).get(iso, [])
        seen: set[str] = set()
        for title in titles:
            try:
                title, text = fetch(title)  # several titles redirect to one article
            except KeyError:  # linked article does not exist yet
                continue
            if title in seen or title in drop or re.search(r"may (also )?refer to", text[:3000]):
                continue  # duplicate, dropped by hand, or a disambiguation page
            seen.add(title)
            info = read_infobox(text, system)
            if title in fixes:
                info = {k: v for k, v in info.items() if k != "review"} | {
                    k: str(v) if k == "date" else v for k, v in fixes[title].items()
                }
            if info.get("date") and info["date"] > date.today().isoformat():
                continue  # not held yet
            entries.append({"article": title, "system": system, **info})
        entries.sort(key=lambda e: e.get("date") or "")
        draft[iso] = entries
        flagged = sum(1 for e in entries if "review" in e)
        print(f"{iso}: {len(entries)} elections" + (f", {flagged} to review" if flagged else ""))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        "# Draft from pipeline.americas.discover; reviewed by hand. Do not regenerate over edits.\n"
        + yaml.safe_dump(draft, allow_unicode=True, sort_keys=False, width=110),
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT.relative_to(DATA.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
