"""Rebuilds the order in which the municipalities were counted from the TSE's ballot-box
reports (boletins de urna), for the motion "A apuração em 60 segundos" (motion/src/apuracao).

    uv run python -m pipeline.apuracao_bu r1     # 2026's 1st round
    uv run python -m pipeline.apuracao_bu r2     # the runoff, once the TSE publishes its reports

The live capture (pipeline.apuracao_ordem) only works on election night: afterwards the
results site stamps every municipality with the same time. The reports keep what it
loses: one row per polling station, office and choice, with DT_BU_RECEBIDO, when the TSE
received that station's report (Brasília time; the closing time beside it is local).
They come out a day or so after the election, one zip per state, listed in the open-data
package resultados-<year>-boletim-de-urna. Until the round's files are listed, the script
says so and stops.

Only the president's rows are read. Per municipality, the stations are taken in the order
they arrived and grouped by minute; each group adds one snapshot in the same format as
pipeline.apuracao_ordem writes (minutes since the polls closed at 17:00, share of stations
counted in tenths of a percent, valid votes, votes per candidate), so the motion reads
either. Abroad (ZZ) is left out, as on the map.

The zips are large (hundreds of MB for SP) and cached in data/raw/tse/bweb/ (not in git).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from .apuracao_cidades import municipalities
from .apuracao_ordem import output_path, save
from .build import DATA
from .municipal_map import SCALE, TOPOLOGY_URL, cached, slim_topology
from .sources import tse_results
from .sources.http import USER_AGENT, get_json

PACKAGE = "https://dadosabertos.tse.jus.br/api/3/action/package_show"
CACHE = DATA / "raw" / "tse" / "bweb"
# Polls close at 17:00 Brasília time in every state: minute 0.
CLOSING = "17:00:00"
# An office's rows, picked out before parsing: a few percent of each file.
PRESIDENT = ';1;"Presidente";'
GOVERNOR = ';3;"Governador";'


class NotPublished(Exception):
    pass


def zips(year: int, round_id: str) -> dict[str, str]:
    """State → URL of its latest report zip for the round."""
    package = get_json(PACKAGE, {"id": f"resultados-{year}-boletim-de-urna"})["result"]
    prefix = f"bweb_{round_id[1]}t_"
    out: dict[str, str] = {}
    for r in package["resources"]:
        name = r["url"].rsplit("/", 1)[-1]
        if not (name.startswith(prefix) and name.endswith(".zip")):
            continue
        uf = name[len(prefix) : len(prefix) + 2]
        # Same state twice: the later generation (the timestamp in the name) wins.
        if uf != "ZZ" and name > out.get(uf, "").rsplit("/", 1)[-1]:
            out[uf] = r["url"]
    if not out:
        raise NotPublished(f"the TSE has not published the {round_id} ballot-box reports of {year} yet")
    return out


def download(url: str) -> Path:
    path = CACHE / url.rsplit("/", 1)[-1]
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as f:
            shutil.copyfileobj(resp, f, 1 << 20)
        tmp.replace(path)
    return path


def stations(path: Path, office: str = PRESIDENT) -> dict[tuple[int, str, str], dict]:
    """(TSE municipality code, zone, station) → received time and votes per (name, party),
    for one office (PRESIDENT, GOVERNOR)."""
    out: dict[tuple[int, str, str], dict] = {}
    with zipfile.ZipFile(path) as z:
        member = next(n for n in z.namelist() if n.endswith(".csv"))
        with z.open(member) as raw:
            lines = io.TextIOWrapper(raw, encoding="latin-1", newline="")
            header = next(csv.reader([next(lines)], delimiter=";"))
            col = {name: i for i, name in enumerate(header)}
            rows = csv.reader((line for line in lines if office in line), delimiter=";")
            for r in rows:
                key = (int(r[col["CD_MUNICIPIO"]]), r[col["NR_ZONA"]], r[col["NR_SECAO"]])
                s = out.setdefault(key, {"at": r[col["DT_BU_RECEBIDO"]], "votes": {}})
                if r[col["DS_TIPO_VOTAVEL"]] == "Nominal":
                    who = (r[col["NM_VOTAVEL"]], r[col["SG_PARTIDO"]])
                    s["votes"][who] = s["votes"].get(who, 0) + int(r[col["QT_VOTOS"]])
    return out


def timeline(found: dict[tuple[int, str, str], dict], start: datetime) -> tuple[list, dict]:
    """Candidates by national votes, and per municipality its snapshots."""
    totals: dict[tuple[str, str], int] = defaultdict(int)
    for s in found.values():
        for who, v in s["votes"].items():
            totals[who] += v
    keys = sorted(totals, key=lambda k: -totals[k])
    index = {k: i for i, k in enumerate(keys)}
    by_place: dict[int, list[dict]] = defaultdict(list)
    for (mun, _, _), s in found.items():
        by_place[mun].append(s)
    places: dict[int, list] = {}
    for mun, ss in by_place.items():
        ss.sort(key=lambda s: s["at"])
        votes = [0] * len(keys)
        rows: list[list] = []
        for n, s in enumerate(ss, 1):
            minute = max(0, int((datetime.fromisoformat(s["at"]) - start).total_seconds() // 60))
            for who, v in s["votes"].items():
                votes[index[who]] += v
            last = len(votes)
            while last and not votes[last - 1]:
                last -= 1
            row = [minute, round(n / len(ss) * 100 * SCALE), sum(votes), *votes[:last]]
            # One snapshot per minute: a later station in the same minute replaces it.
            if rows and rows[-1][0] == minute:
                rows[-1] = row
            else:
                rows.append(row)
        places[mun] = rows
    return keys, places


def main() -> int:
    parser = argparse.ArgumentParser(description="The counting order, from the ballot-box reports.")
    parser.add_argument("round", nargs="?", default="r2", choices=["r1", "r2"])
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        urls = zips(args.year, args.round)
        election = tse_results.election(args.year, args.round, "federal")
    except (NotPublished, tse_results.NotPublished) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    found: dict[tuple[int, str, str], dict] = {}
    for uf, url in sorted(urls.items()):
        path = download(url)
        got = stations(path)
        found.update(got)
        print(f"  {uf}: {len(got):,} stations ({path.stat().st_size / 1e6:,.0f} MB)", flush=True)
    day = min(s["at"] for s in found.values())[:10]
    start = datetime.fromisoformat(f"{day} {CLOSING}")
    keys, places = timeline(found, start)

    _, order = slim_topology(json.loads(cached("municipios.topo.json", TOPOLOGY_URL)))
    position = {code: i for i, code in enumerate(order)}
    listed = municipalities(election, args.year)
    tse_to_slot = {int(tse): position[ibge] for _, tse, ibge in listed if ibge in position}
    state = {
        "year": args.year,
        "round": args.round,
        "office": "presidente",
        "source": "boletins de urna",
        "start": f"{day}T{CLOSING}-03:00",
        "names": [name for name, _ in keys],
        "parties": [party for _, party in keys],
        "places": [None] * len(order),
    }
    missing = 0
    for mun, rows in places.items():
        slot = tse_to_slot.get(mun)
        if slot is None:
            missing += 1
        else:
            state["places"][slot] = rows
    path = args.out or output_path(args.year, args.round)
    save(state, path)
    last = max(r[0] for rows in places.values() for r in rows)
    print(
        f"wrote {path} ({path.stat().st_size / 1e6:,.1f} MB): {len(places) - missing} municipalities, "
        f"last report at minute {last}" + (f", {missing} without a place on the map" if missing else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
