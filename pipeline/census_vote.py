"""Builds data/generated/census-vote.json: who each municipality voted for, next to its census.

    uv run python -m pipeline.census_vote

For every municipality, in the order of the map's topology:

- Census, 1991, 2000, 2010 and 2022: income per person, share of adults with a degree,
  shares of Catholics, Evangelicals and people with no religion, population and (up to
  2010) the urban share.
- Presidential elections, 1st round, 1994–2026: the share of valid votes of the PT's
  candidate and of the strongest rival nationally (FHC, Serra, Alckmin, Aécio,
  Bolsonaro, Flávio).

Sources:
- Atlas of Human Development in Brazil (PNUD, Ipea, FJP) via Ipeadata, for 1991–2010:
  ADH_RDPC (income per person, reais of August 2010), ADH_T_SUPER25M (25+ with a
  degree), ADH_PESOTOT and ADH_PESOURB (population, urban population).
- IBGE census tables (SIDRA): religion, table 137 (1991–2010, whole population) and 9537
  (2022, people aged 10+, the only 2022 table by municipality); 2022 income per person,
  10295, deflated to August 2010 by the INPC like the Atlas; 2022 degrees among 25+,
  10061; 2022 population, 9514.
- TSE: votes by municipality, data/raw/tse/results_<year>.csv (pipeline.fetch_tse_results),
  and for 2026 the TSE's results files, read once and cached in data/raw/tse/.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from itertools import repeat

import yaml

from . import apuracao_cidades
from .build import DATA
from .idhm_census import INPC_2010_08, INPC_2022_07
from .municipal_map import (
    TOPOLOGY_URL,
    TSE_DIR,
    cached,
    ibge_municipalities,
    match_codes,
    pack,
    read_results,
    slim_topology,
    votes_at,
)
from .sources.ipea import by_territory
from .sources.sidra import values

OUTPUT = DATA / "generated" / "census-vote.json"
LIVE_2026 = TSE_DIR / "live_2026_r1_president.json"
CENSUS_YEARS = [1991, 2000, 2010, 2022]
# Each election next to the closest census before or around it.
ELECTIONS = {
    1994: 1991,
    1998: 2000,
    2002: 2000,
    2006: 2010,
    2010: 2010,
    2014: 2010,
    2018: 2022,
    2022: 2022,
    2026: 2022,
}
PT = "PT"
# Uint16 cell meaning "no data".
NONE = 0xFFFF
# Religion (classification 133): total, Catholic (two codes over the years), Evangelical, none.
TOTAL_1991_2010, TOTAL_2022 = 0, 95278
CATHOLIC = [2800, 95263]
EVANGELICAL = 95277
# 1991 had no "Evangelical" total, only its two branches: traditional and Pentecostal.
EVANGELICAL_1991 = [2804, 2812]
NO_RELIGION = 2836


def tenths(v: float | None) -> int:
    return NONE if v is None else min(NONE - 1, max(0, round(v * 10)))


def whole(v: float | None) -> int:
    return NONE if v is None else min(NONE - 1, max(0, round(v)))


# --- Census ---------------------------------------------------------------------------


def religion(year: int) -> dict[str, dict[str, float]]:
    """Municipality → {catholic, evangelical, none}: percent of the population (10+ in 2022)."""
    if year == 2022:
        cats = [TOTAL_2022, 95263, EVANGELICAL, NO_RELIGION]
        raw = values(9537, 2022, 140, {133: cats, 2: [6794], 58: [95253]})
        get = lambda row, c: row.get((c, 6794, 95253))  # noqa: E731
        total_code = TOTAL_2022
    else:
        cats = [TOTAL_1991_2010, *CATHOLIC, EVANGELICAL, *EVANGELICAL_1991, NO_RELIGION]
        raw = values(137, year, 93, {133: cats})
        get = lambda row, c: row.get((c,))  # noqa: E731
        total_code = TOTAL_1991_2010
    out = {}
    for m, row in raw.items():
        total = get(row, total_code)
        if not total:
            continue
        catholic = max((get(row, c) or 0) for c in CATHOLIC)
        evangelical = get(row, EVANGELICAL) or sum(get(row, c) or 0 for c in EVANGELICAL_1991)
        out[m] = {
            "catholic": catholic / total * 100,
            "evangelical": evangelical / total * 100,
            "noReligion": (get(row, NO_RELIGION) or 0) / total * 100,
        }
    return out


def census(year: int) -> dict[str, dict[str, float]]:
    """Municipality → every census variable of that year."""
    out: dict[str, dict[str, float]] = defaultdict(dict)
    if year < 2022:
        for key, code in (
            ("income", "ADH_RDPC"),
            ("degree", "ADH_T_SUPER25M"),
            ("population", "ADH_PESOTOT"),
        ):
            for m, by_year in by_territory(code, "Municípios").items():
                if year in by_year:
                    out[m][key] = by_year[year]
        for m, by_year in by_territory("ADH_PESOURB", "Municípios").items():
            pop = out.get(m, {}).get("population")
            if year in by_year and pop:
                out[m]["urban"] = by_year[year] / pop * 100
    else:
        deflate = INPC_2010_08 / INPC_2022_07
        for m, row in values(10295, 2022, 13431, {}).items():
            if () in row:
                out[m]["income"] = row[()] * deflate
        degree = values(10061, 2022, 2667, {1568: [120704, 99713], 58: [108866]})
        for m, row in degree.items():
            total = row.get((120704, 108866))
            if total:
                out[m]["degree"] = row.get((99713, 108866), 0) / total * 100
        for m, row in values(9514, 2022, 93, {}).items():
            if () in row:
                out[m]["population"] = row[()]
    for m, shares in religion(year).items():
        out[m].update(shares)
    return out


# --- Votes ----------------------------------------------------------------------------


def live_2026() -> dict[str, dict[str, int]]:
    """IBGE code → party → votes, 2026 1st round, from the TSE's files (cached)."""
    if LIVE_2026.exists():
        return json.loads(LIVE_2026.read_text(encoding="utf-8"))
    places = apuracao_cidades.municipalities("6257")
    with ThreadPoolExecutor(apuracao_cidades.WORKERS) as pool:
        ufs = [uf for uf, _, _ in places]
        codes = [tse for _, tse, _ in places]
        got = list(pool.map(apuracao_cidades.read, repeat("6257"), repeat(1), ufs, codes))
    out = {}
    for (_, _, ibge), r in zip(places, got, strict=True):
        if r:
            by_party: dict[str, int] = defaultdict(int)
            for _, party, v in r["cands"]:
                by_party[party] += v
            out[ibge] = dict(by_party)
    LIVE_2026.write_text(json.dumps(out), encoding="utf-8")
    return out


def election_votes(order: list[str]) -> dict[int, dict[str, dict[str, int]]]:
    """Year → IBGE code → party → valid votes, 1st round."""
    paths = sorted(TSE_DIR.glob("results_*.csv"))
    races, places, _ = read_results(paths)
    overrides = (
        yaml.safe_load((DATA / "municipalities.yaml").read_text(encoding="utf-8"))["tse_to_ibge"] or {}
    )
    mapping, unmatched = match_codes(
        places, ibge_municipalities(), {str(k): str(v) for k, v in overrides.items()}
    )
    if unmatched:
        raise SystemExit(f"TSE municipalities without an IBGE code: {unmatched}")
    tse_by_ibge: dict[str, list[str]] = defaultdict(list)
    for tse_code, ibge_code in mapping.items():
        tse_by_ibge[ibge_code].append(tse_code)
    out: dict[int, dict[str, dict[str, int]]] = {}
    for year in ELECTIONS:
        if year == 2026:
            out[year] = live_2026()
            continue
        votes = races.get(("president", str(year), "r1"))
        if not votes:
            continue
        by_place = {}
        for code in order:
            merged: dict[str, int] = defaultdict(int)
            for (_, party), v in votes_at(votes, tse_by_ibge.get(code, [])).items():
                merged[party] += v
            by_place[code] = dict(merged)
        out[year] = by_place
    return out


def rival_of(by_place: dict[str, dict[str, int]]) -> str:
    """The strongest party nationally other than the PT."""
    national: dict[str, int] = defaultdict(int)
    for parties in by_place.values():
        for p, v in parties.items():
            national[p] += v
    return max((p for p in national if p != PT), key=national.__getitem__)


# --- Build ----------------------------------------------------------------------------


def main() -> int:
    _, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    elections_yaml = yaml.safe_load((DATA / "elections.yaml").read_text(encoding="utf-8"))
    # Income is stored in reais of August 2010 (the Atlas's base); this brings it to July 2022.
    out: dict = {
        "censusYears": CENSUS_YEARS,
        "incomeTo2022": round(INPC_2022_07 / INPC_2010_08, 4),
        "census": {},
        "elections": [],
    }
    for year in CENSUS_YEARS:
        data = census(year)

        def get(m: str, k: str, data: dict = data) -> float | None:
            return data.get(m, {}).get(k)

        out["census"][str(year)] = {
            "income": pack("H", [whole(get(m, "income")) for m in order]),
            "degree": pack("H", [tenths(get(m, "degree")) for m in order]),
            "catholic": pack("H", [tenths(get(m, "catholic")) for m in order]),
            "evangelical": pack("H", [tenths(get(m, "evangelical")) for m in order]),
            "noReligion": pack("H", [tenths(get(m, "noReligion")) for m in order]),
            "urban": pack("H", [tenths(get(m, "urban")) for m in order]),
            "population": pack("I", [round(get(m, "population") or 0) for m in order]),
        }
        n = sum(1 for m in order if get(m, "income") is not None and get(m, "evangelical") is not None)
        print(f"  census {year}: {n} municipalities with income and religion")
    for year, by_place in election_votes(order).items():
        rival = rival_of(by_place)
        names = {
            meta["party"]: name
            for name, meta in elections_yaml.get(str(year), {}).get("candidates", {}).items()
        }
        pt, other, valid = [], [], []
        for m in order:
            parties = by_place.get(m, {})
            total = sum(parties.values())
            pt.append(tenths(parties.get(PT, 0) / total * 100) if total else NONE)
            other.append(tenths(parties.get(rival, 0) / total * 100) if total else NONE)
            valid.append(total)
        out["elections"].append(
            {
                "year": year,
                "census": ELECTIONS[year],
                "pt": names.get(PT, PT),
                "rival": names.get(rival, rival),
                "rivalParty": rival,
                "ptShare": pack("H", pt),
                "rivalShare": pack("H", other),
                "valid": pack("I", valid),
            }
        )
        print(f"  {year}: {names.get(PT, PT)} × {names.get(rival, rival)} ({rival})")
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
