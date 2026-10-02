"""Builds data/generated/map.json: results per municipality, president and mayor.

    npm run map   # downloads what is missing, then builds the map dataset

Inputs:
- data/raw/tse/results_<year>.csv, from pipeline.fetch_tse_results:
  president 1994–2022 and mayor 1996–2024.
- IBGE municipality boundaries (TopoJSON, minimum quality) and the official
  municipality list, downloaded from the IBGE API and cached in data/raw/ibge/.
- data/elections.yaml (presidential candidates and colors) and
  data/parties.yaml (party lineages and colors for the mayor map).

TSE and IBGE number municipalities differently. Codes are matched by state and
normalized name; the few names that differ (renamed towns, spelling) are pinned
in data/municipalities.yaml.

Per-municipality numbers are stored as base64 typed arrays, in the order of
the topology's geometries, to keep the single-file page small.
"""

from __future__ import annotations

import base64
import csv
import json
import re
import sys
import unicodedata
from array import array
from collections import defaultdict
from pathlib import Path

import yaml

from .build import DATA
from .sources.http import get

IBGE_DIR = DATA / "raw" / "ibge"
TSE_DIR = DATA / "raw" / "tse"
OUTPUT = DATA / "generated" / "map.json"
TOPOLOGY_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
    "?formato=application/json&qualidade=minima&intrarregiao=municipio"
)
MUNICIPALITIES_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"
# Shares are stored as integers in tenths of a percent.
SCALE = 10
# Index value meaning "no result in this municipality" (it did not exist yet,
# or, for mayors, it has none: Brasília and Fernando de Noronha).
NONE = 255
OTHERS = "others"

Places = dict[str, tuple[str, set[str]]]
# TSE code → candidate key → votes
Votes = dict[str, dict[tuple[str, str], int]]


# --- Municipalities -------------------------------------------------------------------


def normalize_name(name: str) -> str:
    """Letters and digits only: "Olho D'Água" (IBGE) and "OLHO D ÁGUA" (TSE) → "OLHODAGUA"."""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]", "", text)


def cached(name: str, url: str) -> bytes:
    path = IBGE_DIR / name
    if not path.exists():
        IBGE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(url))
    return path.read_bytes()


def ibge_municipalities() -> dict[str, dict]:
    """IBGE code → {name, uf}."""
    out = {}
    for m in json.loads(cached("municipios.json", MUNICIPALITIES_URL)):
        micro = m.get("microrregiao") or {}
        uf = (micro.get("mesorregiao") or {}).get("UF") or m["regiao-imediata"]["regiao-intermediaria"]["UF"]
        out[str(m["id"])] = {"name": m["nome"], "uf": uf["sigla"]}
    return out


def match_codes(
    tse: Places, ibge: dict[str, dict], overrides: dict[str, str]
) -> tuple[dict[str, str], list[str]]:
    """TSE code → IBGE code, by state and name; returns the mapping and what did not match."""
    by_name = {(m["uf"], normalize_name(m["name"])): code for code, m in ibge.items()}
    mapping, unmatched = {}, []
    for tse_code, (uf, names) in tse.items():
        if tse_code in overrides:
            mapping[tse_code] = str(overrides[tse_code])
            continue
        found = {by_name[(uf, normalize_name(n))] for n in names if (uf, normalize_name(n)) in by_name}
        if len(found) == 1:
            mapping[tse_code] = found.pop()
        else:
            unmatched.append(f"{tse_code} {uf} {' / '.join(sorted(names))}")
    return mapping, unmatched


def slim_topology(raw: dict) -> tuple[dict, list[str]]:
    """Keeps only the municipality geometries; returns them with their IBGE codes, in order."""
    obj_name = next(iter(raw["objects"]))
    geometries = raw["objects"][obj_name]["geometries"]
    order = [str(g["properties"]["codarea"]) for g in geometries]
    raw["objects"] = {
        "municipalities": {
            "type": "GeometryCollection",
            "geometries": [{k: v for k, v in g.items() if k != "properties"} for g in geometries],
        }
    }
    return raw, order


# --- Results --------------------------------------------------------------------------


# (office, year, round) → TSE code → candidate the TSE marks as elected
Elected = dict[tuple[str, str, str], dict[str, tuple[str, str]]]


def read_results(paths: list[Path]) -> tuple[dict[tuple[str, str, str], Votes], Places, Elected]:
    """(office, year, round) → TSE code → (candidate, party) → votes; every TSE code's state and
    names; and who the TSE marks as elected."""
    races: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    places: Places = {}
    elected: Elected = defaultdict(dict)
    for path in paths:
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["state"] in ("ZZ", "VT"):  # votes cast abroad / in transit
                    continue
                code = row["tse_municipality_code"]
                places.setdefault(code, (row["state"], set()))[1].add(row["municipality"])
                race = (row["office"], row["year"], f"r{row['round']}")
                races[race][code][(row["candidate"], row["party"])] += int(row["votes"])
                if row["outcome"].startswith("ELEITO"):
                    elected[race][code] = (row["candidate"], row["party"])
    return races, places, elected


def final_round(rounds: dict[str, Votes]) -> Votes:
    """Mayor races: the runoff where there was one, the first round elsewhere."""
    out = dict(rounds.get("r1", {}))
    out.update(rounds.get("r2", {}))
    return out


def elected_first(r: list[tuple[tuple[str, str], int]], elected: tuple[str, str] | None):
    """Puts the officially elected candidate first. It is usually the most voted, but not
    after a tie (the older candidate wins) or when the top candidacy was annulled."""
    if elected is None:
        return r
    return sorted(r, key=lambda kv: kv[0] != elected)


def ranked(votes: dict[tuple[str, str], int]) -> list[tuple[tuple[str, str], int]]:
    return sorted(((k, v) for k, v in votes.items() if v > 0), key=lambda kv: -kv[1])


def share(v: int, total: int) -> int:
    return round(v / total * 100 * SCALE) if total else 0


def pack(typecode: str, values: list[int]) -> str:
    """Little-endian typed array as base64 (B = uint8, H = uint16, I = uint32)."""
    arr = array(typecode, values)
    if sys.byteorder == "big":
        arr.byteswap()
    return base64.b64encode(arr.tobytes()).decode()


def encode_race(rows: list[list[tuple[str, int]]], totals: list[int], labels: list[str]) -> dict:
    """Winner and runner-up (as indexes into `labels`) and their shares, per municipality."""
    index = {label: i for i, label in enumerate(labels)}

    def at(r: list[tuple[str, int]], i: int) -> tuple[int, int]:
        return (index[r[i][0]], r[i][1]) if len(r) > i else (NONE, 0)

    first = [at(r, 0) for r in rows]
    second = [at(r, 1) for r in rows]
    return {
        "labels": labels,
        "winner": pack("B", [w for w, _ in first]),
        "winnerShare": pack("H", [share(v, t) for (_, v), t in zip(first, totals, strict=True)]),
        "second": pack("B", [w for w, _ in second]),
        "secondShare": pack("H", [share(v, t) for (_, v), t in zip(second, totals, strict=True)]),
        "votes": pack("I", totals),
    }


def candidate_names(year: str, elections: dict) -> dict[str, str]:
    """Party → display name for the year's candidates in elections.yaml (one per party)."""
    return {
        meta["party"]: name
        for name, meta in elections.get(year, {}).get("candidates", {}).items()
        if not meta.get("dashed")
    }


def votes_at(votes: Votes, tse_codes: list[str]) -> dict[tuple[str, str], int]:
    """A municipality's votes; a few have had more than one TSE code over the years."""
    if len(tse_codes) == 1:
        return votes.get(tse_codes[0], {})
    merged: dict[tuple[str, str], int] = defaultdict(int)
    for code in tse_codes:
        for key, v in votes.get(code, {}).items():
            merged[key] += v
    return merged


def presidential_race(
    votes: Votes,
    order: list[str],
    tse_by_ibge: dict[str, list[str]],
    names: dict[str, str],
    colors: dict[str, str],
) -> dict:
    """Candidates; the national top two first, then anyone who won or came second somewhere."""

    def label(key: tuple[str, str]) -> str:
        candidate, party = key
        return names.get(party) or candidate.title()

    rows, totals = [], []
    national: dict[str, int] = defaultdict(int)
    for ibge_code in order:
        place = votes_at(votes, tse_by_ibge.get(ibge_code, []))
        merged: dict[str, int] = defaultdict(int)
        for key, v in place.items():
            merged[label(key)] += v
        for c, v in merged.items():
            national[c] += v
        rows.append(sorted(((c, v) for c, v in merged.items() if v > 0), key=lambda kv: -kv[1]))
        totals.append(sum(merged.values()))
    top = [c for c, _ in sorted(national.items(), key=lambda kv: -kv[1])]
    shown = {r[i][0] for r in rows for i in (0, 1) if len(r) > i}
    labels = top[:2] + sorted(shown - set(top[:2]), key=top.index)
    race = encode_race(rows, totals, labels)
    race["colors"] = {c: colors.get(c, "gray") for c in labels}
    return race


def lineage_of(party: str, year: int, lineages: dict) -> str:
    """The lineage a party acronym belonged to in that year, or "others"."""
    for key, lineage in lineages.items():
        for member in lineage["members"]:
            if isinstance(member, str):
                member = {"party": member}
            if member["party"] == party and year >= member.get("since", 0):
                return key
    return OTHERS


def mayor_race(
    votes: Votes,
    elected: dict[str, tuple[str, str]],
    order: list[str],
    tse_by_ibge: dict[str, list[str]],
    year: int,
    lineages: dict,
) -> dict:
    """Elected mayor's party per municipality; labels are party acronyms as written that year."""
    rows, totals, mayors = [], [], []
    for ibge_code in order:
        codes = tse_by_ibge.get(ibge_code, [])
        winner = next((elected[c] for c in codes if c in elected), None)
        r = elected_first(ranked(votes_at(votes, codes)), winner)
        rows.append([(party, v) for (_, party), v in r])
        totals.append(sum(v for _, v in r))
        mayors.append(r[0][0][0].title() if r else "")
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        for party, _ in r[:2]:
            counts[party] += 1
    labels = sorted(counts, key=lambda p: -counts[p])
    race = encode_race(rows, totals, labels)
    race["lineages"] = [lineage_of(p, year, lineages) for p in labels]
    race["mayors"] = "\n".join(mayors)
    return race


# --- CLI ------------------------------------------------------------------------------


def main() -> int:
    paths = sorted(TSE_DIR.glob("results_*.csv"))
    if not paths:
        print(
            "error: no TSE results in data/raw/tse; run `uv run python -m pipeline.fetch_tse_results`",
            file=sys.stderr,
        )
        return 1
    elections = yaml.safe_load((DATA / "elections.yaml").read_text(encoding="utf-8"))
    lineages = yaml.safe_load((DATA / "parties.yaml").read_text(encoding="utf-8"))
    overrides = (
        yaml.safe_load((DATA / "municipalities.yaml").read_text(encoding="utf-8"))["tse_to_ibge"] or {}
    )
    topology, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    ibge = ibge_municipalities()
    races, places, elected = read_results(paths)

    mapping, unmatched = match_codes(places, ibge, {str(k): str(v) for k, v in overrides.items()})
    if unmatched:
        print(
            "error: TSE municipalities without an IBGE code; pin them in data/municipalities.yaml:",
            *unmatched,
            sep="\n  ",
            file=sys.stderr,
        )
        return 1
    tse_by_ibge: dict[str, list[str]] = defaultdict(list)
    for tse_code, ibge_code in mapping.items():
        tse_by_ibge[ibge_code].append(tse_code)

    out: dict = {
        "municipalities": {"names": [ibge[c]["name"] for c in order], "uf": [ibge[c]["uf"] for c in order]},
        "lineages": {k: {"color": v["color"]} for k, v in lineages.items()},
        "topology": topology,
        "races": {},
    }
    by_office: dict[str, dict[str, dict[str, Votes]]] = defaultdict(lambda: defaultdict(dict))
    for (office, year, round_id), votes in races.items():
        by_office[office][year][round_id] = votes

    for year, rounds in sorted(by_office["president"].items()):
        meta = elections.get(year, {})
        colors = {name: m["color"] for name, m in meta.get("candidates", {}).items()}
        for round_id, votes in sorted(rounds.items()):
            race = presidential_race(votes, order, tse_by_ibge, candidate_names(year, elections), colors)
            out["races"][f"president-{year}-{round_id}"] = race
            print(f"  president {year} {round_id}: {len(votes)} municipalities, {race['labels'][:4]}")
    for year, rounds in sorted(by_office["mayor"].items()):
        winners = {**elected[("mayor", year, "r1")], **elected[("mayor", year, "r2")]}
        race = mayor_race(final_round(rounds), winners, order, tse_by_ibge, int(year), lineages)
        out["races"][f"mayor-{year}"] = race
        print(f"  mayor {year}: {len(final_round(rounds))} municipalities, {len(race['labels'])} parties")

    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"
    OUTPUT.write_text(text, encoding="utf-8")
    print(
        f"wrote {OUTPUT.relative_to(DATA.parent)} ({len(text.encode()) / 1e6:.1f} MB); "
        f"{len(order)} shapes, {len(mapping)} TSE municipalities matched"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
