"""Builds data/generated/map.json: presidential results per municipality.

    uv run python -m pipeline.fetch_tse_results   # once: TSE results (≈1.6 GB download)
    uv run python -m pipeline.municipal_map        # → data/generated/map.json

Inputs:
- data/raw/tse/president_by_municipality.csv, from pipeline.fetch_tse_results.
- IBGE municipality boundaries (TopoJSON, minimum quality) and the official
  municipality list, downloaded from the IBGE API and cached in data/raw/ibge/.

TSE and IBGE number municipalities differently. Codes are matched by state and
normalized name; the few names that differ (renamed towns, spelling) are pinned
in data/municipalities.yaml.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict

import yaml

from .build import DATA
from .sources.http import get

IBGE_DIR = DATA / "raw" / "ibge"
TSE_RESULTS = DATA / "raw" / "tse" / "president_by_municipality.csv"
OUTPUT = DATA / "generated" / "map.json"
TOPOLOGY_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
    "?formato=application/json&qualidade=minima&intrarregiao=municipio"
)
MUNICIPALITIES_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"
# Shares are stored as integers in tenths of a percent to keep the file small.
SCALE = 10


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
    tse: dict[str, tuple[str, set[str]]], ibge: dict[str, dict], overrides: dict[str, str]
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


def read_results() -> tuple[dict, dict[str, tuple[str, set[str]]]]:
    """(year, round) → TSE code → candidate key → votes, plus each TSE code's state and names."""
    races: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    places: dict[str, tuple[str, set[str]]] = {}
    with TSE_RESULTS.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["state"] in ("ZZ", "VT"):  # votes cast abroad / in transit
                continue
            code = str(int(row["tse_municipality_code"]))  # "08478" in some years, "8478" in others
            places.setdefault(code, (row["state"], set()))[1].add(row["municipality"])
            key = (row["party"], row["candidate"])
            races[(row["year"], f"r{row['round']}")][code][key] += int(row["votes"])
    return races, places


def candidate_names(year: str, elections: dict) -> dict[str, str]:
    """Party → display name for the year's candidates in elections.yaml (one per party)."""
    return {
        meta["party"]: name
        for name, meta in elections.get(year, {}).get("candidates", {}).items()
        if not meta.get("dashed")
    }


def display(key: tuple[str, str], names: dict[str, str]) -> str:
    party, urn_name = key
    return names.get(party) or urn_name.title()


def build_race(
    votes_by_place: dict,
    order: list[str],
    tse_by_ibge: dict[str, str],
    names: dict[str, str],
    colors: dict[str, str],
) -> dict:
    """Winner, runner-up and their shares per municipality, in topology order."""
    national: dict[str, int] = defaultdict(int)
    per_place: dict[str, dict[str, int]] = {}
    for code, votes in votes_by_place.items():
        merged: dict[str, int] = defaultdict(int)
        for key, v in votes.items():
            merged[display(key, names)] += v
        per_place[code] = merged
        for c, v in merged.items():
            national[c] += v

    rows = []
    for ibge_code in order:
        votes = per_place.get(tse_by_ibge.get(ibge_code, ""), {})
        total = sum(votes.values())
        ranked = sorted(votes.items(), key=lambda kv: -kv[1])
        rows.append((ranked, total))

    # Candidates that appear in the file: the national top two and anyone who won or came second somewhere.
    top = [c for c, _ in sorted(national.items(), key=lambda kv: -kv[1])]
    listed = top[:2] + sorted(
        {r[i][0] for r, _ in rows for i in (0, 1) if len(r) > i} - set(top[:2]), key=top.index
    )
    index = {c: i for i, c in enumerate(listed)}

    def share(v: int, total: int) -> int:
        return round(v / total * 100 * SCALE) if total else 0

    return {
        "candidates": listed,
        "colors": {c: colors.get(c, "gray") for c in listed},
        "winner": [index[r[0][0]] if r else -1 for r, _ in rows],
        "winnerShare": [share(r[0][1], t) if r else 0 for r, t in rows],
        "second": [index[r[1][0]] if len(r) > 1 else -1 for r, _ in rows],
        "secondShare": [share(r[1][1], t) if len(r) > 1 else 0 for r, t in rows],
        "votes": [t for _, t in rows],
    }


def slim_topology(raw: dict) -> tuple[dict, list[str]]:
    """Keeps only the municipality geometries, with their IBGE code as id."""
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


def main() -> int:
    if not TSE_RESULTS.exists():
        print(
            f"error: {TSE_RESULTS.relative_to(DATA.parent)} is missing; "
            "run `uv run python -m pipeline.fetch_tse_results` first",
            file=sys.stderr,
        )
        return 1
    elections = yaml.safe_load((DATA / "elections.yaml").read_text(encoding="utf-8"))
    overrides = (
        yaml.safe_load((DATA / "municipalities.yaml").read_text(encoding="utf-8"))["tse_to_ibge"] or {}
    )
    topology, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    ibge = ibge_municipalities()
    races, places = read_results()

    mapping, unmatched = match_codes(places, ibge, {str(k): str(v) for k, v in overrides.items()})
    if unmatched:
        print(
            "error: TSE municipalities without an IBGE code; pin them in data/municipalities.yaml:",
            *unmatched,
            sep="\n  ",
            file=sys.stderr,
        )
        return 1
    tse_by_ibge = {i: t for t, i in mapping.items()}
    missing_shapes = sorted(set(ibge) - set(order))
    out = {
        "municipalities": {
            "names": [ibge[c]["name"] for c in order],
            "uf": [ibge[c]["uf"] for c in order],
        },
        "topology": topology,
        "races": {},
    }
    for (year, round_id), votes in sorted(races.items()):
        meta = elections.get(year, {})
        colors = {name: m["color"] for name, m in meta.get("candidates", {}).items()}
        race = build_race(votes, order, tse_by_ibge, candidate_names(year, elections), colors)
        out["races"][f"{year}-{round_id}"] = race
        no_data = sum(1 for w in race["winner"] if w < 0)
        print(
            f"  {year} {round_id}: {len(votes)} municipalities, candidates {race['candidates']}, "
            f"no data for {no_data} shapes"
        )
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"
    OUTPUT.write_text(text, encoding="utf-8")
    print(
        f"wrote {OUTPUT.relative_to(DATA.parent)} ({len(text.encode()) / 1e6:.1f} MB); "
        f"{len(order)} shapes, {len(mapping)} TSE municipalities matched"
        + (f"; IBGE codes without a shape: {missing_shapes}" if missing_shapes else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
