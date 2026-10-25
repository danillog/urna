"""Records the order in which the municipalities were counted, live, for the motion
"A apuração em 60 segundos" (motion/src/apuracao).

    uv run python -m pipeline.apuracao_ordem r2            # election night, from ~16:50
    uv run python -m pipeline.apuracao_ordem r2 --every 60 # a pass a minute
    uv run python -m pipeline.apuracao_ordem r1 --once     # one pass, to check it works

Why live: once the count is over the TSE rewrites every municipality's file, and they
all end up with the same date and time (checked on 2026's 1st round), so the order
cannot be recovered afterwards. This script reads the president's count of every
municipality every few minutes and keeps, per municipality, each change: when it was
seen (minutes since the first pass), the percent of polling stations counted, the
valid votes and every candidate's votes. Municipalities already at 100% are not read
again. Stop it with Ctrl-C at any time; run it again and it carries on from the file.

Output, data/raw/apuracao/<year>-<round>-ordem.json:
    start   when the first pass began (Brasília time, ISO 8601)
    names, parties   candidates, in the order they were first seen
    places  one entry per municipality, in the topology order of map.json: null, or a
            list of [minutes, counted (tenths of a percent), valid, votes of names[0],
            votes of names[1], ...] (shorter rows mean 0 for the names added later)

Same files and parsing as pipeline.apuracao_cidades; abroad is left out, as on the map.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from itertools import repeat
from pathlib import Path
from zoneinfo import ZoneInfo

from .apuracao_cidades import WORKERS, municipalities, read
from .build import DATA
from .municipal_map import SCALE, TOPOLOGY_URL, cached, slim_topology
from .sources import tse_results

OUT_DIR = DATA / "raw" / "apuracao"
BRASILIA = ZoneInfo("America/Sao_Paulo")
PRESIDENT = 1
DONE = 100 * SCALE


def output_path(year: int, round_id: str) -> Path:
    return OUT_DIR / f"{year}-{round_id}-ordem.json"


def load(path: Path, year: int, round_id: str, size: int) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    start = datetime.now(BRASILIA).replace(microsecond=0)
    return {
        "year": year,
        "round": round_id,
        "office": "presidente",
        "start": start.isoformat(),
        "names": [],
        "parties": [],
        "places": [None] * size,
    }


def row(state: dict, minutes: float, r: dict) -> list:
    """One snapshot: minutes, counted, valid, then votes by candidate index."""
    keys = list(zip(state["names"], state["parties"], strict=True))
    votes: dict[int, int] = {}
    for name, party, v in r["cands"]:
        if (name, party) not in keys:
            keys.append((name, party))
            state["names"].append(name)
            state["parties"].append(party)
        votes[keys.index((name, party))] = v
    n = max(votes, default=-1) + 1
    return [round(minutes, 1), round(r["counted"] * SCALE), r["valid"], *(votes.get(i, 0) for i in range(n))]


def counted(snapshots: list | None) -> int:
    return snapshots[-1][1] if snapshots else -1


def one_pass(state: dict, todo: list[tuple[int, str, str]], election: str, year: int) -> int:
    """Reads the municipalities not finished yet; returns how many changed."""
    start = datetime.fromisoformat(state["start"])
    with ThreadPoolExecutor(WORKERS) as pool:
        got = list(
            pool.map(
                read,
                repeat(election),
                repeat(PRESIDENT),
                [uf for _, uf, _ in todo],
                [tse for _, _, tse in todo],
                repeat(year),
            )
        )
    minutes = (datetime.now(BRASILIA) - start).total_seconds() / 60
    changed = 0
    for (i, _, _), r in zip(todo, got, strict=True):
        if not r or r["counted"] <= 0:
            continue
        places = state["places"]
        if round(r["counted"] * SCALE) == counted(places[i]):
            continue
        places[i] = [*(places[i] or []), row(state, minutes, r)]
        changed += 1
    return changed


def save(state: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="The order the municipalities were counted in.")
    parser.add_argument("round", nargs="?", default="r2", choices=["r1", "r2"])
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--every", type=int, default=120, help="seconds between passes (default 120)")
    parser.add_argument("--once", action="store_true", help="one pass, then stop")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        election = tse_results.election(args.year, args.round, "federal")
    except tse_results.NotPublished as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    _, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    position = {code: i for i, code in enumerate(order)}
    listed = municipalities(election, args.year)
    places = [(position[ibge], uf, tse) for uf, tse, ibge in listed if ibge in position]
    path = args.out or output_path(args.year, args.round)
    state = load(path, args.year, args.round, len(order))
    print(f"{len(places)} municipalities, writing {path}")
    try:
        while True:
            began = time.monotonic()
            todo = [p for p in places if counted(state["places"][p[0]]) < DONE]
            changed = one_pass(state, todo, election, args.year)
            save(state, path)
            done = sum(counted(state["places"][i]) >= DONE for i, _, _ in places)
            now = datetime.now(BRASILIA).strftime("%H:%M:%S")
            print(f"{now}  read {len(todo)}, {changed} changed, {done}/{len(places)} at 100%", flush=True)
            if args.once or done == len(places):
                break
            time.sleep(max(0.0, args.every - (time.monotonic() - began)))
    except KeyboardInterrupt:
        save(state, path)
        print("stopped; run again to carry on", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
