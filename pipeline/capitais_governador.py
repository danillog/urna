"""Builds motion/data/capitais-governador.json: the vote for governor inside the capitals of
the states that elected their governor in the 1st round, for the motion "Como a capital
votou para governador" (motion/src/capitais).

    uv run python -m pipeline.capitais_governador
    uv run python -m pipeline.capitais_governador runoff

With "runoff", the other states instead (no one above half: a 2nd round on 25/10), written to
motion/data/capitais-governador-2turno.json with the two who go on in place of the elected.

From the ballot-box reports (pipeline.apuracao_bu, same cached zips): the governor's rows of
every station, with when each report arrived. A report counts every vote typed for a
candidate, but the TSE leaves out of the valid votes those of a candidate whose registration
was annulled (Garotinho, in Rio de Janeiro): the official count (data/raw/results/<year>-r1.json,
pipeline.results) gives the valid total, and the candidates whose votes make up the difference
are left out here too. Who won outright (more than half of the valid votes) comes from that.
Each station of the capital is placed by its polling place's coordinates (TSE, the same file
pipeline.capitals uses); the motion puts each polling place in its weighting area with the
geometry in capitals.json.

Per capital: the candidates (the state's four most voted; the rest summed as "Outros"), who
was elected (or the two in the runoff) and with what share of the state, the polling places
[longitude, latitude], and the stations [polling place index or -1, minute after 17:00, votes per candidate].
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime

from . import capitals
from .apuracao_bu import CLOSING, GOVERNOR, NotPublished, download, stations, zips
from .apuracao_cidades import municipalities
from .build import DATA
from .sources import tse_results

YEAR = 2026
SHOWN = 4
OFFICIAL = DATA / "raw" / "results" / f"{YEAR}-r1.json"


def annulled(official: list[dict]) -> set[tuple[str, str]]:
    """Candidates whose votes the TSE left out of the valid ones: the official valid total is
    smaller than the sum of the candidates' votes by exactly their votes."""
    top = official[0]
    valid = top["votes"] / top["share"] * 100
    excess = sum(c["votes"] for c in official) - valid
    if excess < valid * 0.001:
        return set()
    # Shares are rounded to 0.01%: a match within that.
    tolerance = valid * 0.0002 + 2
    for c in official:
        if abs(c["votes"] - excess) <= tolerance:
            return {(c["name"], c["party"])}
    for i, a in enumerate(official):
        for b in official[i + 1 :]:
            if abs(a["votes"] + b["votes"] - excess) <= tolerance:
                return {(a["name"], a["party"]), (b["name"], b["party"])}
    raise ValueError(f"cannot tell whose {excess:,.0f} votes the TSE left out")


OUTPUT = DATA.parent / "motion" / "data" / "capitais-governador.json"
OUTPUT_RUNOFF = DATA.parent / "motion" / "data" / "capitais-governador-2turno.json"


def main(argv: list[str]) -> int:
    runoff = "runoff" in argv
    output = OUTPUT_RUNOFF if runoff else OUTPUT
    try:
        urls = zips(YEAR, "r1")
        election = tse_results.election(YEAR, "r1", "state")
    except (NotPublished, tse_results.NotPublished) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    # IBGE code of each capital → (uf, TSE code).
    listed = {ibge: (uf.upper(), tse) for uf, tse, ibge in municipalities(election, YEAR)}
    official = json.loads(OFFICIAL.read_text(encoding="utf-8"))["governor"]
    out = []
    for code, name in capitals.CAPITALS.items():
        uf, tse = listed[code]
        found = stations(download(urls[uf]), GOVERNOR)
        # Valid: the official list's candidates, minus those whose votes the TSE left out. A
        # candidate missing from the list altogether (annulled before the count) is out too.
        listed_official = {(c["name"], c["party"]) for c in official[uf]["candidates"]}
        left_out = annulled(official[uf]["candidates"])
        left_out |= {who for s in found.values() for who in s["votes"] if who not in listed_official}
        for s in found.values():
            for who in left_out:
                s["votes"].pop(who, None)
        totals: dict[tuple[str, str], int] = defaultdict(int)
        for s in found.values():
            for who, v in s["votes"].items():
                totals[who] += v
        valid = sum(totals.values())
        ranked = sorted(totals, key=lambda k: -totals[k])
        share = totals[ranked[0]] / valid * 100
        if (share <= 50) != runoff:
            print(f"  {uf}: {'elected' if share > 50 else 'runoff'} ({ranked[0][0]} {share:.1f}%), left out")
            continue
        # The first two and their shares of the state: the elected, or the runoff.
        top = [{"name": n, "party": p, "share": round(totals[n, p] / valid * 100, 2)} for n, p in ranked[:2]]
        shown = ranked[:SHOWN]
        index = {k: i for i, k in enumerate(shown)}
        others = len(ranked) > SHOWN

        places, _ = capitals.polling_places(uf, tse)
        spots: dict[tuple[float, float], int] = {}
        rows = []
        day = min(s["at"] for s in found.values())[:10]
        start = datetime.fromisoformat(f"{day} {CLOSING}")
        for (mun, zone, section), s in found.items():
            if mun != int(tse):
                continue
            where = places.get(f"{int(zone):04d}/{int(section):04d}")
            spot = spots.setdefault(where, len(spots)) if where else -1
            votes = [0] * (len(shown) + others)
            for who, v in s["votes"].items():
                votes[index.get(who, len(shown))] += v
            minute = max(0, int((datetime.fromisoformat(s["at"]) - start).total_seconds() // 60))
            rows.append([spot, minute, *votes])
        rows.sort(key=lambda r: r[1])
        unplaced = sum(sum(r[2:]) for r in rows if r[0] < 0) / max(1, sum(sum(r[2:]) for r in rows)) * 100
        out.append(
            {
                "code": code,
                "name": name,
                "uf": uf,
                "names": [n for n, _ in shown] + (["Outros"] if others else []),
                "parties": [p for _, p in shown] + ([""] if others else []),
                **({"runoff": top} if runoff else {"elected": top[0]}),
                "annulled": [n for n, _ in sorted(left_out)],
                "start": f"{day}T{CLOSING}-03:00",
                "places": [[round(x, 5), round(y, 5)] for x, y in spots],
                "stations": rows,
            }
        )
        print(
            f"  {uf}: "
            + (
                " vs ".join(f"{t['name']} {t['share']:.2f}%" for t in top) + " to the runoff"
                if runoff
                else f"{ranked[0][0]} elected with {share:.2f}%"
            )
            + (f" ({', '.join(n for n, _ in left_out)}: votes annulled); " if left_out else "; ")
            + f"{name}: {len(rows):,} stations, {unplaced:.1f}% of votes unplaced"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"year": YEAR, "capitals": out}, ensure_ascii=False, separators=(",", ":"))
    output.write_text(text, encoding="utf-8")
    print(f"wrote {output} ({output.stat().st_size / 1e6:,.1f} MB): {len(out)} capitals")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
