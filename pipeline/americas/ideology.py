"""Ideological family of each winning party (see data/americas/parties.yaml)."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass

import yaml

from ..build import DATA
from .discover import fetch
from .wikitext import find_template, plain, template_params

GPS_FILE = DATA / "raw" / "americas" / "global_party_survey_2019.tab"
PARTIES = DATA / "americas" / "parties.yaml"
FAMILIES = ("left", "centre-left", "centre-right", "right")
# Global Party Survey V4_Ord cut points on the 0–10 economic scale.
GPS_BANDS = (2.5, 5.0, 7.5)
# Below this many experts per country, the survey's scores are not used.
MIN_EXPERTS = 5

# Wikipedia "position" words on a left (0) to right (6) line.
POSITION_SCALE = {
    "far-left": 0,
    "left-wing": 1,
    "centre-left": 2,
    "center-left": 2,
    "centre": 3,
    "center": 3,
    "centre-right": 4,
    "center-right": 4,
    "right-wing": 5,
    "far-right": 6,
}


@dataclass(frozen=True)
class Family:
    family: str
    source: str  # human-readable, shown in the tooltip and listed in the footer
    score: float | None = None


def gps_band(score: float) -> str:
    return FAMILIES[sum(score >= cut for cut in GPS_BANDS)]


def load_gps() -> dict[tuple[str, str], dict]:
    with GPS_FILE.open(encoding="utf-8", errors="replace") as f:
        return {(r["ISO"], r["Partyabb"]): r for r in csv.DictReader(f, delimiter="\t")}


def wikipedia_position(article: str) -> str | None:
    """The `position` field of a party's infobox, as plain text."""
    _, text = fetch(article)
    span = find_template(text, "Infobox political party") or find_template(text, "Infobox")
    if not span:
        return None
    position = template_params(text[span[0] : span[1]]).get("position")
    return plain(position) if position else None


def current_position(position: str) -> str:
    """Drops past or factional positions: "Current: Centre-right Historical: Left-wing" →
    "Centre-right"; "Centre-left Before 1990: Left-wing" → "Centre-left"."""
    position = re.sub(r"\{\{\w+|class=\w+|[|{}]", " ", position)  # leftover list templates
    position = re.sub(r"^\s*Current:\s*", "", position, flags=re.I)
    past = r"\b(?:Historical(?:ly)?|Before \d{4}|Formerly|Factions?)\b|\d{4}\s*[–-]\s*\d{4}\s*:"
    return " ".join(re.split(past, position, flags=re.I)[0].split())


def position_family(position: str) -> str | None:
    """ "Centre-left to left-wing" → mean of the words found, mapped to a band.
    A pure "centre", "big tent" or "syncretic" has no side and returns None."""
    position = current_position(position)
    words = re.findall(
        r"far-left|far-right|left-wing|right-wing|cent(?:re|er)-left|cent(?:re|er)-right|cent(?:re|er)\b",
        position.lower(),
    )
    if not words:
        return None
    mean = sum(POSITION_SCALE[w] for w in words) / len(words)
    if mean == 3:
        return None
    return "left" if mean < 1.5 else "centre-left" if mean < 3 else "centre-right" if mean < 4.5 else "right"


def resolve(gps: dict, iso: str, entry: dict) -> Family:
    if "family" in entry:
        if entry["family"] not in FAMILIES:
            raise ValueError(f"{iso}: unknown family {entry['family']!r}")
        return Family(entry["family"], f"manual: {entry['note']}")
    if "gps" in entry:
        row = gps.get((iso, entry["gps"]))
        if not row or not row["V4_Scale"]:
            raise ValueError(f"{iso}: {entry['gps']} has no Global Party Survey score")
        if float(row["Experts"] or 0) < MIN_EXPERTS:
            raise ValueError(f"{iso}: only {row['Experts']} experts; use the Wikipedia position instead")
        score = float(row["V4_Scale"])
        return Family(gps_band(score), f"Global Party Survey 2019: {score:.1f}/10", score)
    article = entry["wikipedia"]
    position = wikipedia_position(article)
    family = position_family(position or "")
    if not family:
        raise ValueError(f"{iso}: Wikipedia position of {article!r} is {position!r}; decide by hand")
    return Family(family, f"Wikipedia, {article}: {current_position(position or '').strip()}")


def resolve_all() -> dict[str, dict[str, Family]]:
    gps = load_gps()
    table = yaml.safe_load(PARTIES.read_text(encoding="utf-8"))
    return {
        iso: {party: resolve(gps, iso, e) for party, e in parties.items()} for iso, parties in table.items()
    }


if __name__ == "__main__":
    errors = []
    gps = load_gps()
    for iso, parties in yaml.safe_load(PARTIES.read_text(encoding="utf-8")).items():
        for party, entry in parties.items():
            try:
                f = resolve(gps, iso, entry)
                print(f"{iso} {party[:44]:44} {f.family:12} {f.source[:90]}")
            except (ValueError, KeyError) as e:
                errors.append(f"{iso} {party}: {e}")
    print("\n".join(["", "UNRESOLVED:", *errors]) if errors else "\nall resolved")
