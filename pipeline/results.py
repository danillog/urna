"""Official 1st-round results of 2026 from the TSE, matched to the polls' candidates.

    uv run python -m pipeline.results     # writes data/raw/results/2026-r1.json

The TSE's files are final once the count ends; this keeps a copy so the build
does not depend on their site. pipeline.presidential and pipeline.states read it
to set each race's result, and so rank the pollsters by how close they got.

Shares are of valid votes, as the TSE publishes them. For the Senate, where each
voter chose two names in 2026, that is the share of all valid votes cast across
both choices: the same base as the polls' "consolidated" figures.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

from .sources.http import get

# Not imported from .build: build reads this module.
DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "raw" / "results"
BASE = "https://resultados.tse.jus.br/oficial/ele2026"
UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
    "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]  # fmt: skip
# Party names as the polls and the TSE write them → one spelling.
PARTY_ALIASES = {"PCDOB": "PCDOB", "PODEMOS": "PODE", "SOLIDARIEDADE": "SD", "UNIAO": "UNIAO"}


def path(year: int = 2026, round_id: str = "r1") -> Path:
    return RAW / f"{year}-{round_id}.json"


def num(v: object) -> float:
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return 0.0


def plain(text: str) -> str:
    """Upper case, no accents or punctuation: "Dr. Furlan" → "DR FURLAN"."""
    ascii_ = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9 ]", " ", ascii_)


def party_key(party: str) -> str:
    key = plain(party).replace(" ", "")
    return PARTY_ALIASES.get(key, key)


def parse(raw: dict) -> dict:
    """Counted percent, totalization time and every candidate's votes and share of valid votes."""
    office = raw["carg"][0]
    valid = num(raw["v"]["vv"])
    cands = [
        {
            "name": str(c.get("nmu") or c.get("nm")),
            "party": str(p["sg"]),
            "votes": int(num(c.get("vap"))),
            "share": round(num(c.get("vap")) / valid * 100, 2) if valid else 0.0,
            "status": str(c.get("st", "")),
        }
        for g in office["agr"]
        for p in g["par"]
        for c in p["cand"]
    ]
    cands.sort(key=lambda c: -c["votes"])
    return {
        "counted": num(raw["s"]["pst"]),
        "totalizedAt": f"{raw['dt']} {raw['ht']}",
        "candidates": cands,
    }


def fetch(election: str, office: int, place: str) -> dict:
    uf = "br" if place == "br" else place.lower()
    url = f"{BASE}/{election}/dados/{uf}/{place.lower()}-c{office:04d}-e{election.zfill(6)}-u.json"
    return parse(json.loads(get(url)))


def refresh() -> dict:
    out = {
        "source": BASE,
        "fetchedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "president": fetch("6257", 1, "br"),
        "governor": {uf: fetch("6259", 3, uf) for uf in UFS},
        "senate": {uf: fetch("6259", 5, uf) for uf in UFS},
    }
    RAW.mkdir(parents=True, exist_ok=True)
    path().write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def load(year: int, round_id: str) -> dict | None:
    p = path(year, round_id)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def match(candidates: dict[str, str], tse: list[dict]) -> tuple[dict[str, float], list[str]]:
    """Poll names ({name: party}) → their official share; and the names that matched nobody.

    By party first: one candidate of that party is the one. Two or more (a party
    may run two for the Senate), or none (the poll file may name an old party),
    fall back to a shared word of the name.
    """
    out: dict[str, float] = {}
    missing: list[str] = []
    taken: set[int] = set()
    for name, party in candidates.items():
        words = {w for w in plain(name).split() if len(w) >= 3} or set(plain(name).split())
        same_party = [i for i, c in enumerate(tse) if party_key(c["party"]) == party_key(party)]
        # Most words in common first: "Carlos Jordy" is JORDY, not the other Carlos.
        overlap = {i: len(words & set(plain(c["name"]).split())) for i, c in enumerate(tse)}
        best = max(overlap.values(), default=0)
        by_name = [i for i, n in overlap.items() if n and n == best]
        if len(same_party) == 1 and (not by_name or same_party[0] in by_name or len(by_name) != 1):
            pick = same_party
        else:
            pick = [i for i in by_name if i in same_party] or by_name
        pick = [i for i in pick if i not in taken]
        if len(pick) == 1:
            taken.add(pick[0])
            out[name] = tse[pick[0]]["share"]
        else:
            missing.append(name)
    return out, missing


def main() -> int:
    data = refresh()
    races = [("president", "BR", data["president"])]
    races += [(office, uf, data[office][uf]) for office in ("governor", "senate") for uf in UFS]
    incomplete = [f"{o} {uf} ({r['counted']}%)" for o, uf, r in races if r["counted"] < 100]
    print(f"wrote {path().relative_to(DATA.parent)}: {len(races)} races")
    if incomplete:
        print("  not fully counted yet:", ", ".join(incomplete))
    return 0


if __name__ == "__main__":
    sys.exit(main())
