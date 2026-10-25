"""Official 2026 results from the TSE, matched to the polls' candidates.

    uv run python -m pipeline.results      # 1st round → data/raw/results/2026-r1.json
    uv run python -m pipeline.results r2   # runoff: president, and governor where there is one

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
import urllib.error
from datetime import UTC, datetime
from pathlib import Path

from .sources import tse_results
from .sources.http import get

# Not imported from .build: build reads this module.
DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "raw" / "results"
YEAR = 2026
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


def fetch(election: str, office: int, place: str, year: int = YEAR) -> dict:
    return parse(json.loads(get(tse_results.file_url(year, election, office, place.lower()))))


def fetch_runoff(election: str, office: int, uf: str) -> dict | None:
    """A state's runoff, or None where it had none (the TSE has no file for it)."""
    try:
        return fetch(election, office, uf)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise


def refresh(round_id: str = "r1") -> dict:
    federal = tse_results.election(YEAR, round_id, "federal")
    state = tse_results.election(YEAR, round_id, "state")
    out: dict = {
        "source": tse_results.base(YEAR),
        "fetchedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "president": fetch(federal, 1, "br"),
    }
    if round_id == "r1":
        out["governor"] = {uf: fetch(state, 3, uf) for uf in UFS}
        out["senate"] = {uf: fetch(state, 5, uf) for uf in UFS}
    else:
        runoffs = {uf: fetch_runoff(state, 3, uf) for uf in UFS}
        out["governor"] = {uf: r for uf, r in runoffs.items() if r}
    RAW.mkdir(parents=True, exist_ok=True)
    path(YEAR, round_id).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
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
    round_id = sys.argv[1] if len(sys.argv) > 1 else "r1"
    if round_id not in ("r1", "r2"):
        print("usage: python -m pipeline.results [r1|r2]", file=sys.stderr)
        return 1
    try:
        data = refresh(round_id)
    except tse_results.NotPublished as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    races = [("president", "BR", data["president"])]
    races += [(office, uf, r) for office in ("governor", "senate") for uf, r in data.get(office, {}).items()]
    incomplete = [f"{o} {uf} ({r['counted']}%)" for o, uf, r in races if r["counted"] < 100]
    print(f"wrote {path(YEAR, round_id).relative_to(DATA.parent)}: {len(races)} races")
    if incomplete:
        print("  not fully counted yet:", ", ".join(incomplete))
    return 0


if __name__ == "__main__":
    sys.exit(main())
