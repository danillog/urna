"""Builds data/generated/apuracao-cidades.json: the 2026 count per municipality.

    npm run apuracao:cidades          # 1st round: president, governor, senator
    npm run apuracao:cidades -- r2    # 2nd round: president, governor

The Worker cannot do this live: the TSE publishes one file per municipality and
office (5,570 of them), and the free plan allows 50 requests per call. So the
page carries a snapshot instead, taken by this script and inlined in the build;
run it again (and rebuild) while the count advances.

Inputs, from resultados.tse.jus.br:
- config/mun-e<election>-cm.json: every municipality's TSE and IBGE codes.
- dados/<uf>/<uf><tse>-c<office>-e<election>-u.json: one municipality's count,
  the same format the Worker reads for states.
- The IBGE topology cached by pipeline.municipal_map, for the geometry order.

Per municipality: the leader and the runner-up (indexes into `names` and
`parties`) with their shares of valid votes, valid votes, and the percent of
polling stations counted; same base64 typed arrays as map.json.
"""

from __future__ import annotations

import json
import sys
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from itertools import repeat

from .build import DATA
from .municipal_map import SCALE, TOPOLOGY_URL, cached, pack, share, slim_topology
from .sources.http import get

BASE = "https://resultados.tse.jus.br/oficial/ele2026"
OUTPUT = DATA / "generated" / "apuracao-cidades.json"
# election codes: federal (president) and state (governor, senator)
ELECTIONS = {"r1": {"federal": "6257", "state": "6259"}, "r2": {"federal": "6258", "state": "6260"}}
# slug the page uses → (election, TSE office code, has a 2nd round)
OFFICES = {
    "presidente": ("federal", 1, True),
    "governador": ("state", 3, True),
    "senador": ("state", 5, False),
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


def municipalities(election: str) -> list[tuple[str, str, str]]:
    """(uf, TSE code, IBGE code) for every municipality in the country (abroad excluded)."""
    config = json.loads(get(f"{BASE}/{election}/config/mun-e{election.zfill(6)}-cm.json"))
    return [(a["cd"], m["cd"], m["cdi"]) for a in config["abr"] if a["cd"] != "zz" for m in a["mu"]]


def read(election: str, office: int, uf: str, tse: str) -> dict | None:
    url = f"{BASE}/{election}/dados/{uf}/{uf}{tse}-c{office:04d}-e{election.zfill(6)}-u.json"
    try:
        raw = json.loads(get(url))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    return parse(raw)


def parse(raw: dict) -> dict:
    """Counted percent, valid votes, totalization time and candidates by votes."""
    cands = []
    for group in (raw.get("carg") or [{}])[0].get("agr", []):
        for party in group.get("par", []):
            for c in party.get("cand", []):
                name = str(c.get("nmu") or c.get("nm"))
                cands.append((name, str(party.get("sg", "")), int(num(c.get("vap")))))
    cands.sort(key=lambda c: -c[2])
    return {
        "counted": num(raw.get("s", {}).get("pst")),
        "valid": int(num(raw.get("v", {}).get("vv"))),
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
    }


def main() -> int:
    round_id = sys.argv[1] if len(sys.argv) > 1 else "r1"
    if round_id not in ELECTIONS:
        print("usage: python -m pipeline.apuracao_cidades [r1|r2]", file=sys.stderr)
        return 1
    _, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    out = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    places: dict[str, list[tuple[str, str, str]]] = {}
    for slug, (kind, office, runoff) in OFFICES.items():
        if round_id == "r2" and not runoff:
            continue
        election = ELECTIONS[round_id][kind]
        places.setdefault(election, municipalities(election))
        todo = places[election]
        with ThreadPoolExecutor(WORKERS) as pool:
            got = list(pool.map(read, repeat(election), repeat(office), *zip(*todo, strict=True)))
        results = {ibge: r for (_, _, ibge), r in zip(todo, got, strict=True) if r}
        missing = len(todo) - len(results)
        out[f"{slug}-{round_id}"] = encode(order, results)
        failed = f", {missing} failed" if missing else ""
        print(f"  {slug} {round_id}: {len(results)} municipalities{failed}")
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
