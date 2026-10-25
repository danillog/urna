"""Builds data/generated/apuracao-cidades.json: the 2026 count per municipality.

    npm run apuracao:cidades          # 1st round: president, governor, senator
    npm run apuracao:cidades -- r2    # 2nd round: president, governor

    # A rehearsal on a finished election, written aside (2024: mayors, both rounds):
    uv run python -m pipeline.apuracao_cidades r2 --year 2024 --out /tmp/ensaio.json

Election numbers come from the TSE's configuration (pipeline.sources.tse_results), so the
runoff needs no code change: until the TSE lists it, the script says so and stops. In a
runoff the TSE lists only the places that have one (all for president, some states for
governor); the others are written as "no result".

The Worker cannot do this live: the TSE publishes one file per municipality and
office (5,570 of them), and the free plan allows 50 requests per call. So the
page carries a snapshot instead, taken by this script and shipped with the build;
run it again (and rebuild) while the count advances.

Inputs, from resultados.tse.jus.br:
- config/mun-e<election>-cm.json: every municipality's TSE and IBGE codes.
- dados/<uf>/<uf><tse>-c<office>-e<election>-u.json: one municipality's count,
  the same format the Worker reads for states.
- The IBGE topology cached by pipeline.municipal_map, for the geometry order.

Per municipality: the leader and the runner-up (indexes into `names` and
`parties`) with their shares of valid votes, valid votes, the percent of
polling stations counted, and who chose no one: blank and null votes (of the
votes cast) and abstention (of the electorate of the stations counted); same
base64 typed arrays as map.json.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from itertools import repeat
from pathlib import Path

from .build import DATA
from .municipal_map import SCALE, TOPOLOGY_URL, cached, pack, share, slim_topology
from .sources import tse_results
from .sources.http import get

YEAR = 2026
OUTPUT = DATA / "generated" / "apuracao-cidades.json"
# slug the page uses → (kind of election, TSE office code, has a 2nd round)
OFFICES = {
    "presidente": ("federal", 1, True),
    "governador": ("state", 3, True),
    "senador": ("state", 5, False),
    "prefeito": ("municipal", 11, True),  # municipal years: rehearsals only
}
# Uint16 index meaning "no result here".
NONE = 0xFFFF
WORKERS = 16


def num(v: object) -> float:
    """TSE numbers are strings, decimals with a comma."""
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return 0.0


def municipalities(election: str, year: int = YEAR) -> list[tuple[str, str, str]]:
    """(uf, TSE code, IBGE code) for every municipality of the election (abroad excluded)."""
    url = f"{tse_results.base(year)}/{election}/config/mun-e{election.zfill(6)}-cm.json"
    config = json.loads(get(url))
    return [(a["cd"], m["cd"], m["cdi"]) for a in config["abr"] if a["cd"] != "zz" for m in a["mu"]]


def read(election: str, office: int, uf: str, tse: str, year: int = YEAR) -> dict | None:
    url = tse_results.file_url(year, election, office, tse, uf)
    try:
        raw = json.loads(get(url))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    return parse(raw)


def parse(raw: dict) -> dict:
    """Counted percent, valid, blank and null votes, abstention, totalization time and
    candidates by votes."""
    cands = []
    for group in (raw.get("carg") or [{}])[0].get("agr", []):
        for party in group.get("par", []):
            for c in party.get("cand", []):
                name = str(c.get("nmu") or c.get("nm"))
                cands.append((name, str(party.get("sg", "")), int(num(c.get("vap")))))
    cands.sort(key=lambda c: -c[2])
    v, e = raw.get("v", {}), raw.get("e", {})
    turnout = num(e.get("pc"))
    return {
        "counted": num(raw.get("s", {}).get("pst")),
        "valid": int(num(v.get("vv"))),
        "blank": int(num(v.get("vb"))),
        # Null votes, including those for candidates annulled (as the Worker counts them).
        "nulls": int(num(v.get("tvn")) + num(v.get("van"))),
        "absent": 100 - turnout if turnout else 0.0,
        "at": f"{raw['dt']} {raw['ht']}" if raw.get("dt") and raw.get("ht") else None,
        "cands": cands,
    }


def sortable(br: str) -> str:
    """ "04/10/2026 21:35:56" → "2026-10-04 21:35:56"."""
    date, _, time = br.partition(" ")
    return f"{'-'.join(reversed(date.split('/')))} {time}"


def encode(order: list[str], results: dict[str, dict]) -> dict:
    """Leader and runner-up per municipality, in topology order."""
    keys: dict[tuple[str, str], int] = {}

    def index(name: str, party: str) -> int:
        return keys.setdefault((name, party), len(keys))

    winner, wshare, second, sshare, votes, counted = [], [], [], [], [], []
    blank, nulls, absent = [], [], []
    for code in order:
        r = results.get(code)
        cands = [c for c in (r["cands"] if r else []) if c[2] > 0]
        total = r["valid"] if r else 0
        for i, (idx, sh) in enumerate([(winner, wshare), (second, sshare)]):
            if len(cands) > i:
                idx.append(index(cands[i][0], cands[i][1]))
                sh.append(share(cands[i][2], total))
            else:
                idx.append(NONE)
                sh.append(0)
        votes.append(total)
        counted.append(round(r["counted"] * SCALE) if r else 0)
        cast = total + r["blank"] + r["nulls"] if r else 0
        blank.append(share(r["blank"], cast) if cast else 0)
        nulls.append(share(r["nulls"], cast) if cast else 0)
        absent.append(round(r["absent"] * SCALE) if cast else 0)
    times = [r["at"] for r in results.values() if r and r["at"]]
    return {
        "totalizedAt": max(times, key=sortable) if times else None,
        "names": [n for n, _ in keys],
        "parties": [p for _, p in keys],
        "winner": pack("H", winner),
        "winnerShare": pack("H", wshare),
        "second": pack("H", second),
        "secondShare": pack("H", sshare),
        "votes": pack("I", votes),
        "counted": pack("H", counted),
        "blank": pack("H", blank),
        "nulls": pack("H", nulls),
        "absent": pack("H", absent),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="The count per municipality.")
    parser.add_argument("round", nargs="?", default="r1", choices=["r1", "r2"])
    parser.add_argument("--year", type=int, default=YEAR)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args()
    round_id, year, output = args.round, args.year, args.out
    try:
        listed = tse_results.config(year).get(round_id, {})
        # Mayors only in municipal years: 2026's configuration lists a "municipal" election
        # too (a local one held with the general election), not the country's mayors.
        wanted = ("municipal",) if year % 4 == 0 else ("federal", "state")
        kinds = [k for k in wanted if k in listed]
        elections = {kind: tse_results.election(year, round_id, kind) for kind in kinds}
        if not elections:
            tse_results.pleito(year, round_id)  # raises with the reason
    except tse_results.NotPublished as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    _, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    out = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
    places: dict[str, list[tuple[str, str, str]]] = {}
    for slug, (kind, office, runoff) in OFFICES.items():
        if (round_id == "r2" and not runoff) or kind not in elections:
            continue
        election = elections[kind]
        places.setdefault(election, municipalities(election, year))
        todo = places[election]
        with ThreadPoolExecutor(WORKERS) as pool:
            ufs = [uf for uf, _, _ in todo]
            codes = [tse for _, tse, _ in todo]
            got = list(pool.map(read, repeat(election), repeat(office), ufs, codes, repeat(year)))
        # A file or two fails now and then under 16 parallel requests: asked once more, alone.
        got = [r or read(election, office, uf, tse, year) for r, uf, tse in zip(got, ufs, codes, strict=True)]
        results = {ibge: r for (_, _, ibge), r in zip(todo, got, strict=True) if r}
        missing = len(todo) - len(results)
        if not results:
            print(f"  {slug} {round_id}: nothing read, left as it was", file=sys.stderr)
            continue
        out[f"{slug}-{round_id}"] = encode(order, results)
        failed = f", {missing} failed" if missing else ""
        print(f"  {slug} {round_id}: {len(results)} municipalities{failed}")
    output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {output} ({output.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
