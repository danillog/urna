"""Builds data/generated/ideology.json: where each member of Congress sits, by their votes.

    uv run python -m pipeline.ideology

For the term in office (February 2023 on), Chamber and Senate apart:

- A matrix of members × contested roll calls: yes 1, no (or obstruction) 0; a roll call
  is contested when at least 10% voted on the losing side. Absences, abstentions and
  roll calls before a member took the seat are filled with that roll call's mean, so
  they pull toward the middle instead of counting as a side.
- Members with fewer than 50 contested votes are left out (too few to place).
- The first principal component of that matrix (power iteration): the line along which
  votes split the most. Turned so that the PL sits to the right of the PT, and scaled
  to −1…+1 by the most extreme member. A position relative to the house, in this term:
  not on the same scale as the parties' academic estimates.
- Checked against Zucco & Power: the correlation between each party's mean position and
  the party's score (data/congress.yaml placement, as in the Congress tab) is printed and
  written out, and shown on the page.

The method is the simplest of its family (W-NOMINATE and Bayesian ideal points refine
it); with one dimension and many roll calls they tend to agree closely.

Inputs: the Câmara's votacoesVotos and votacoes files and the Senate's roll calls, both
cached by pipeline.mandate in data/raw/camara/ and data/raw/senado/ (not in git).
"""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import defaultdict

import yaml

from .build import DATA
from .congress import CONFIG, Placer, acronym, read_bls

OUTPUT = DATA / "generated" / "ideology.json"
CAMARA = DATA / "raw" / "camara"
SENADO = DATA / "raw" / "senado"
START = "2023-02-01"
MIN_VOTES = 50
MIN_MINORITY = 0.10
SIDE = {"Sim": 1.0, "Não": 0.0, "Obstrução": 0.0}


def chamber_votes() -> tuple[dict[str, dict[str, float]], dict[str, dict]]:
    """Member id → roll call → 1/0; and member id → name, party, state (their latest)."""
    plenary: set[str] = set()
    for path in sorted(CAMARA.glob("votacoes-20*.csv")):
        with path.open(encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f, delimiter=";"):
                if r["siglaOrgao"] == "PLEN" and r["data"] >= START:
                    plenary.add(r["id"])
    votes: dict[str, dict[str, float]] = defaultdict(dict)
    who: dict[str, dict] = {}
    for path in sorted(CAMARA.glob("votacoesVotos-20*.csv")):
        with path.open(encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f, delimiter=";"):
                if r["idVotacao"] not in plenary or r["voto"] not in SIDE:
                    continue
                dep = r["deputado_id"]
                votes[dep][r["idVotacao"]] = SIDE[r["voto"]]
                who[dep] = {
                    "name": r["deputado_nome"],
                    "party": acronym(r["deputado_siglaPartido"]),
                    "uf": r["deputado_siglaUf"],
                }
    return votes, who


def senate_votes() -> tuple[dict[str, dict[str, float]], dict[str, dict]]:
    votes: dict[str, dict[str, float]] = defaultdict(dict)
    who: dict[str, dict] = {}
    for path in sorted(SENADO.glob("votacoes-20*.json")):
        for v in json.loads(path.read_text(encoding="utf-8")) or []:
            if v.get("votacaoSecreta") == "S" or str(v.get("dataSessao", "")) < START:
                continue
            roll = str(v.get("codigoSessaoVotacao") or v.get("sequencialVotacao"))
            for x in v.get("votos") or []:
                vote = x.get("siglaVotoParlamentar")
                if vote not in SIDE:
                    continue
                code = str(x["codigoParlamentar"])
                votes[code][roll] = SIDE[vote]
                who[code] = {
                    "name": x["nomeParlamentar"],
                    "party": acronym(x.get("siglaPartidoParlamentar") or ""),
                    "uf": x.get("siglaUFParlamentar"),
                }
    return votes, who


def first_dimension(votes: dict[str, dict[str, float]]) -> dict[str, float]:
    """Members' scores on the first principal component of the contested roll calls."""
    rolls: dict[str, list[float]] = defaultdict(list)
    for v in votes.values():
        for roll, x in v.items():
            rolls[roll].append(x)
    contested = [
        r
        for r, xs in rolls.items()
        if len(xs) >= 10 and MIN_MINORITY <= sum(xs) / len(xs) <= 1 - MIN_MINORITY
    ]
    means = {r: sum(rolls[r]) / len(rolls[r]) for r in contested}
    members = [m for m, v in votes.items() if sum(1 for r in contested if r in v) >= MIN_VOTES]
    # Centred matrix: each member's vote minus the roll call's mean; missing → 0 (the mean).
    rows = [[votes[m][r] - means[r] if r in votes[m] else 0.0 for r in contested] for m in members]
    k = len(contested)
    # Power iteration on XᵀX for the leading loading vector.
    w = [1.0 / math.sqrt(k)] * k
    for _ in range(200):
        scores = [sum(a * b for a, b in zip(row, w, strict=True)) for row in rows]
        nxt = [0.0] * k
        for row, s in zip(rows, scores, strict=True):
            if s:
                for j, x in enumerate(row):
                    if x:
                        nxt[j] += x * s
        norm = math.sqrt(sum(x * x for x in nxt)) or 1.0
        nxt = [x / norm for x in nxt]
        done = sum(abs(a - b) for a, b in zip(w, nxt, strict=True)) < 1e-9
        w = nxt
        if done:
            break
    scores = [sum(a * b for a, b in zip(row, w, strict=True)) for row in rows]
    return dict(zip(members, scores, strict=True))


def pearson(xs: list[float], ys: list[float]) -> float:
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else 0.0


def place(votes: dict[str, dict[str, float]], who: dict[str, dict], placer: Placer, house: str) -> dict:
    raw = first_dimension(votes)
    by_party: dict[str, list[float]] = defaultdict(list)
    for m, s in raw.items():
        by_party[who[m]["party"]].append(s)
    mean = {p: sum(v) / len(v) for p, v in by_party.items()}
    # Right is positive: the PL to the right of the PT.
    if mean.get("PL", 0) < mean.get("PT", 0):
        raw = {m: -s for m, s in raw.items()}
        mean = {p: -s for p, s in mean.items()}
    top = max(abs(s) for s in raw.values()) or 1.0
    members = {m: round(s / top, 3) for m, s in raw.items()}
    # Check: party means against Zucco & Power's scores (parties with 5 members or more).
    pairs = []
    for party, scores in by_party.items():
        known, _ = placer.score(party, 2026)
        if len(scores) >= 5 and known is not None:
            pairs.append((mean[party] / top, known))
    r = pearson([a for a, _ in pairs], [b for _, b in pairs]) if len(pairs) >= 3 else None
    print(f"  {house}: {len(members)} members placed; party means vs Zucco & Power, r = {r:.2f} "
          f"({len(pairs)} parties)")  # fmt: skip
    return {
        "validation": {"r": round(r, 3) if r is not None else None, "parties": len(pairs)},
        "members": {m: {**who[m], "score": s} for m, s in sorted(members.items(), key=lambda kv: kv[1])},
    }


def main() -> int:
    config = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    placer = Placer(config, read_bls())
    out = {"since": START, "minVotes": MIN_VOTES, "minMinority": MIN_MINORITY}
    for house, read in (("chamber", chamber_votes), ("senate", senate_votes)):
        votes, who = read()
        if not votes:
            print(f"  {house}: no roll calls cached; run pipeline.mandate first", file=sys.stderr)
            continue
        out[house] = place(votes, who, placer, house)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
