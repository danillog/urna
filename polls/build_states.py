import json
from datetime import date
from pathlib import Path

from build import norm_pollster

ROOT = Path(__file__).parent
SRC = ROOT / "raw" / "states"
ORIGIN = date(2026, 1, 1)
ELECTION = {"t1": date(2026, 10, 4), "t2": date(2026, 10, 25)}
MAX_NAMED = 4
LEFT_RED = {"PT"}
RIGHT_BLUE = {"PL"}
FALLBACK = ["gold", "teal", "red", "blue"]

EXCLUDE = {
    ("AM", "gov_t1", "Quaest", "2026-09-23"),
    ("AM", "gov_t2", "Quaest", "2026-09-23"),
    ("AM", "sen_t1", "Quaest", "2026-09-23"),
}

EXTRA_NOTES = {
    "RJ": "Garotinho foi declarado inelegível em 11/09, mas os institutos seguiram testando cenários com ele até o fim de setembro; o gráfico usa esses cenários.",
    "DF": "A candidatura de José Roberto Arruda foi barrada pelo TSE em 24/09; o 1º turno usa só cenários sem ele.",
    "AM": "A pesquisa Quaest de 23/09 foi suspensa pelo TRE-AM e ficou de fora.",
    "RR": "Só há duas pesquisas no ano, ambas da Quaest; as linhas ligam os pontos em vez de uma média.",
    "SP": "Algumas pesquisas do 1º semestre ainda testavam nomes que desistiram; os votos deles estão em Outros.",
    "MG": "Rodrigo Pacheco aparecia nas pesquisas até junho e saiu da disputa; por isso o 1º turno começa em julho.",
}

STATE_NAMES = {
    "AC": "Acre", "AL": "Alagoas", "AM": "Amazonas", "AP": "Amapá", "BA": "Bahia", "CE": "Ceará",
    "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MG": "Minas Gerais",
    "MS": "Mato Grosso do Sul", "MT": "Mato Grosso", "PA": "Pará", "PB": "Paraíba", "PE": "Pernambuco",
    "PI": "Piauí", "PR": "Paraná", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte", "RO": "Rondônia",
    "RR": "Roraima", "RS": "Rio Grande do Sul", "SC": "Santa Catarina", "SE": "Sergipe", "SP": "São Paulo",
    "TO": "Tocantins",
}


def fmt_party(p: str) -> str:
    return p.capitalize() if p.isupper() and len(p) > 6 else p


def day(s: str) -> int:
    return (date.fromisoformat(s) - ORIGIN).days


def rank_candidates(polls, names):
    last_day = max(day(p["date"]) for p in polls)
    recent = [p for p in polls if day(p["date"]) >= last_day - 30] or polls
    def score(c):
        vals = [p["v"][c] for p in recent if c in p["v"]]
        return sum(vals) / len(vals) if vals else -1
    counted = [c for c in names if sum(1 for p in polls if c in p["v"]) >= 1]
    return sorted(counted, key=score, reverse=True)


def assign_colors(named, parties):
    colors, used = {}, set()
    for c in named:
        party = (parties.get(c) or "").upper()
        if party in LEFT_RED and "red" not in used:
            colors[c] = "red"
        elif party in RIGHT_BLUE and "blue" not in used:
            colors[c] = "blue"
        else:
            continue
        used.add(colors[c])
    for c in named:
        if c in colors:
            continue
        colors[c] = next(col for col in FALLBACK if col not in used)
        used.add(colors[c])
    colors["Outros"] = "violet"
    colors["BNI"] = "gray"
    return colors


def office_payload(uf, key, block):
    turn = "t2" if key.endswith("t2") else "t1"
    parties = block.get("candidates", {})
    polls = []
    for p in block["polls"]:
        pollster = norm_pollster(p["p"])
        if (uf, key, p["p"], p["date"]) in EXCLUDE or (uf, key, pollster, p["date"]) in EXCLUDE:
            continue
        if not ("2026-01-01" <= p["date"] <= "2026-09-29"):
            continue
        polls.append({**p, "p": pollster})
    if not polls:
        return None
    seen, uniq = set(), []
    for p in sorted(polls, key=lambda q: q["date"]):
        k = (p["p"], p["date"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)
    polls = uniq
    ranked = rank_candidates(polls, list(parties))
    if key == "gov_t2" and block.get("matchup"):
        named = [c for c in block["matchup"] if c in parties] or ranked[:2]
    else:
        named = ranked[:MAX_NAMED] if key != "gov_t2" else ranked[:2]
    folded = [c for c in ranked if c not in named]
    out_polls, has_outros, has_bni = [], False, False
    for p in polls:
        rec = {"p": p["p"], "d": day(p["date"])}
        if p.get("n"):
            rec["n"] = int(p["n"])
        for c in named:
            if c in p["v"]:
                rec[c] = float(p["v"][c])
        extra = [p["v"][c] for c in folded if c in p["v"]]
        if "Outros" in p["v"]:
            extra.append(p["v"]["Outros"])
        if extra and key != "gov_t2":
            rec["Outros"] = round(float(sum(extra)), 1)
            has_outros = True
        if "BNI" in p["v"]:
            rec["BNI"] = float(p["v"]["BNI"])
            has_bni = True
        out_polls.append(rec)
    if has_outros and all(p.get("Outros", 0) == 0 for p in out_polls):
        has_outros = False
        for p in out_polls:
            p.pop("Outros", None)
    cands = named + (["Outros"] if has_outros else []) + (["BNI"] if has_bni else [])
    return {
        "candidates": cands,
        "election_day": (ELECTION[turn] - ORIGIN).days,
        "polls": out_polls,
        "result": None,
        "winner": None,
        "accuracy": [],
        "colors": assign_colors(named, parties),
        "parties": {c: fmt_party(parties.get(c, "")) for c in named},
        "folded": folded,
        "note": block.get("note", ""),
    }


def main():
    out = {}
    for f in sorted(SRC.glob("*.json")):
        s = json.loads(f.read_text())
        uf = s["uf"]
        entry = {"name": STATE_NAMES.get(uf, s.get("state", uf)), "note": EXTRA_NOTES.get(uf, ""), "gov": {}, "sen": {}, "sources": s.get("sources", [])[:12]}
        for key in ("gov_t1", "gov_t2", "sen_t1"):
            if s.get(key):
                payload = office_payload(uf, key, s[key])
                if payload:
                    office, turn = key.split("_")
                    entry[office][turn] = payload
        out[uf] = entry
        print(uf, {o: {t: len(v["polls"]) for t, v in entry[o].items()} for o in ("gov", "sen")},
              "gov:", entry["gov"].get("t1", {}).get("candidates"), "sen:", entry["sen"].get("t1", {}).get("candidates"))
    (ROOT / "data_states.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
