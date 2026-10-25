"""Signed polling error, for the video "As pesquisas erram mais para algum lado?".

    uv run python motion/scripts/erro_pesquisas.py     (from the repository root)

Writes motion/data/erro-pesquisas.json. The rules, as the script of the video states them:
1. Same base: every poll in valid votes. With undecided/blank/null in the source, a share is
   divided by (100 − that); when the source already gives valid votes, as is; otherwise
   (2022 1st round) by the sum of what the poll lists.
2. Each pollster's last poll whose fieldwork ended in the 10 days before the election.
3. Signed error: poll − result, in points. Positive: the poll gave the candidate more than
   the ballot box did.

Sides. President: the PT's candidate against the strongest rival (the runner-up when the PT
won, the winner when it lost). States (2026, 1st round): each candidate's party placed left,
centre or right with the Chamber's groups in data/generated/congress.json.
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "generated"
OUT = ROOT / "motion" / "data" / "erro-pesquisas.json"
WINDOW = 10
MIN_ROUNDS = 3
SKIP = {"undecided", "others"}
PT = {"2010": "Dilma", "2014": "Dilma", "2018": "Haddad", "2022": "Lula", "2026": "Lula"}
SIDE = {
    "left": "esquerda",
    "centre-left": "esquerda",
    "centre": "centro",
    "centre-right": "direita",
    "right": "direita",
}


def valid(poll: dict, race: dict) -> dict[str, float]:
    v = poll["v"]
    if race["validVotesOnly"]:
        base = 100.0
    elif "undecided" in v:
        base = 100 - v["undecided"]
    else:
        base = sum(x for k, x in v.items() if k != "undecided")
    return {k: x / base * 100 for k, x in v.items() if k not in SKIP}


def finals(race: dict) -> list[dict]:
    """Each pollster's last poll in the window, in valid votes."""
    day = race["electionDay"]
    last: dict[str, dict] = {}
    for p in race["polls"]:
        if day - WINDOW <= p["d"] < day and (p["p"] not in last or p["d"] >= last[p["p"]]["d"]):
            last[p["p"]] = p
    return [{"p": p["p"], "d": p["d"], "v": valid(p, race)} for p in last.values()]


def errors(race: dict) -> list[dict]:
    result = race["result"]
    out = []
    for f in finals(race):
        e = {c: round(f["v"][c] - result[c], 2) for c in result if c in f["v"]}
        if e:
            out.append(
                {
                    "p": f["p"],
                    "d": f["d"],
                    "e": e,
                    "abs": round(statistics.mean(abs(x) for x in e.values()), 2),
                }
            )
    return out


def mean(xs):
    xs = list(xs)
    return round(statistics.mean(xs), 2) if xs else None


def main() -> None:
    data = json.loads((DATA / "elections.json").read_text())
    congress = json.loads((DATA / "congress.json").read_text())
    group = {}
    for h in congress["houses"]["chamber"]:
        for p in h["parties"]:
            if p["group"]:
                group[p["party"].upper()] = p["group"]
    methods = data["methods"]

    president = []
    for year, el in sorted(data["presidential"].items()):
        for rnd, race in sorted(el["rounds"].items()):
            if not race["result"]:
                continue
            res = race["result"]
            pt = PT[year]
            rival = max((c for c in res if c != pt), key=lambda c: res[c])
            errs = errors(race)
            president.append(
                {
                    "year": int(year),
                    "round": rnd,
                    "pt": pt,
                    "rival": rival,
                    "result": res,
                    "polls": len(errs),
                    "ptError": mean(x["e"][pt] for x in errs if pt in x["e"]),
                    "rivalError": mean(x["e"][rival] for x in errs if rival in x["e"]),
                    # Positive: the polls had the PT's candidate better placed than the ballot did.
                    "marginError": mean(
                        x["e"][pt] - x["e"][rival] for x in errs if pt in x["e"] and rival in x["e"]
                    ),
                    "absError": mean(x["abs"] for x in errs),
                    "pollsters": errs,
                }
            )

    states = []
    for uf, st in sorted(data["states"].items()):
        for office in ("governor", "senate"):
            race = st[office].get("r1")
            if not race or not race["result"]:
                continue
            for x in errors(race):
                for cand, err in x["e"].items():
                    party = race["parties"].get(cand, "").upper()
                    states.append(
                        {
                            "uf": uf,
                            "office": office,
                            "p": x["p"],
                            "cand": cand,
                            "party": party,
                            "side": SIDE.get(group.get(party, ""), "sem classificação"),
                            "e": err,
                            "abs": x["abs"],
                        }
                    )
    by_side = defaultdict(list)
    for s in states:
        by_side[s["side"]].append(s["e"])

    # Pollsters: mean absolute error over every race (president and states) with a final poll.
    per = defaultdict(list)
    for r in president:
        for x in r["pollsters"]:
            per[x["p"]].append(("pres", f"{r['year']}-{r['round']}", x["abs"]))
    seen = defaultdict(set)
    for s in states:
        seen[(s["p"], s["uf"], s["office"])].add(s["abs"])
    for (p, uf, off), a in seen.items():
        per[p].append(("state", f"{uf}-{off}", next(iter(a))))
    pres_rounds = defaultdict(int)
    for p, rows in per.items():
        pres_rounds[p] = sum(1 for k, _, _ in rows if k == "pres")
    ranking = sorted(
        (
            {
                "p": p,
                "races": len(rows),
                "presRounds": pres_rounds[p],
                "absError": mean(a for _, _, a in rows),
                "method": methods.get(p),
            }
            for p, rows in per.items()
        ),
        key=lambda r: r["absError"],
    )

    # The fair comparison: presidential rounds only (the same races for everyone), 3 or more.
    ranking_pres = sorted(
        (
            {"p": p, "rounds": len(a), "absError": mean(a), "method": methods.get(p)}
            for p, a in ((p, [x for k, _, x in rows if k == "pres"]) for p, rows in per.items())
            if len(a) >= MIN_ROUNDS
        ),
        key=lambda r: r["absError"],
    )

    by_method = defaultdict(list)
    for r in president:
        for x in r["pollsters"]:
            m = methods.get(x["p"])
            if m and r["pt"] in x["e"] and r["rival"] in x["e"]:
                by_method[m].append(x["e"][r["pt"]] - x["e"][r["rival"]])
    polls = sum(len(r["polls"]) for e in data["presidential"].values() for r in e["rounds"].values())
    polls_states = sum(
        len(r["polls"])
        for s in data["states"].values()
        for o in ("governor", "senate")
        for r in s[o].values()
    )
    pollsters = {
        p["p"] for e in data["presidential"].values() for r in e["rounds"].values() for p in r["polls"]
    }
    pollsters |= {
        p["p"]
        for s in data["states"].values()
        for o in ("governor", "senate")
        for r in s[o].values()
        for p in r["polls"]
    }
    out = {
        "rules": {"window": WINDOW},
        "counts": {
            "polls": polls + polls_states,
            "president": polls,
            "states": polls_states,
            "pollsters": len(pollsters),
            "withMethod": sum(1 for p in pollsters if p in methods),
        },
        "president": president,
        "statesBySide": {k: {"n": len(v), "mean": mean(v)} for k, v in by_side.items()},
        "states": states,
        "ranking": ranking,
        "rankingPresident": ranking_pres,
        "byMethod": {
            k: {"n": len(v), "mean": mean(v), "abs": mean(abs(x) for x in v)} for k, v in by_method.items()
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(
        json.dumps({k: out[k] for k in ("counts", "statesBySide", "byMethod")}, ensure_ascii=False, indent=1)
    )
    for r in president:
        print(
            r["year"],
            r["round"],
            r["pt"],
            r["ptError"],
            r["rival"],
            r["rivalError"],
            "margin",
            r["marginError"],
            "abs",
            r["absError"],
            "n",
            r["polls"],
        )
    for r in ranking_pres:
        print("  PRES", r)
    for r in ranking:
        print(
            f"  {r['p']:24} races {r['races']:3} pres {r['presRounds']:2}  abs {r['absError']}  {r['method']}"
        )


if __name__ == "__main__":
    main()
