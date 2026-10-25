"""Writes motion/data/eleitos.json: the 513 federal deputies elected in 2026, one row each.

    uv run python motion/scripts/eleitos.py

Reads data/generated/profiles.json (pipeline.profiles) and, for the race/color the
profiles leave out, the TSE's candidate file it caches in data/raw/profiles/
(consulta_cand_2026.zip), matched by state and ballot number. Each row keeps only what
the unit chart regroups by: trajectory, gender, age at inauguration, schooling,
occupation, race/color and party. Also a short line on the 54 senators elected.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILES = ROOT / "data" / "generated" / "profiles.json"
TSE = ROOT / "data" / "raw" / "profiles" / "consulta_cand_2026.zip"
OUT = ROOT / "motion" / "data" / "eleitos.json"
# The election before for each office (src/model/profiles.ts, PREVIOUS).
PREVIOUS = {"deputado-federal": 2022, "senador": 2018}
RACE = {"BRANCA": "branca", "PARDA": "parda", "PRETA": "preta", "INDÍGENA": "indigena", "AMARELA": "amarela"}


def reelected(p: dict) -> bool:
    before = PREVIOUS[p["office"]]
    return any(
        h["year"] == before and h["office"] == p["office"] and h["uf"] == p["uf"] and h["result"] == "elected"
        for h in p["history"]
    )


def path(p: dict) -> str:
    """Re-elected; back to the same office after a break; from another elected office; never elected."""
    if reelected(p):
        return "reeleito"
    if p["kind"] == "returning":
        return "volta"
    if p["kind"] == "other-office":
        return "outro-cargo"
    return "estreante"


def tse_rows() -> dict[tuple[str, str, str], dict]:
    """(office, state, number) → the candidate's row."""
    out: dict[tuple[str, str, str], dict] = {}
    with zipfile.ZipFile(TSE) as z:
        for name in z.namelist():
            if not name.lower().endswith(".csv"):
                continue
            with z.open(name) as f:
                for r in csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";"):
                    office = {"DEPUTADO FEDERAL": "deputado-federal", "SENADOR": "senador"}.get(r["DS_CARGO"].upper())
                    if office:
                        out[(office, r["SG_UF"], r["NR_CANDIDATO"])] = r
    return out


def main() -> None:
    people = json.loads(PROFILES.read_text())["people"]
    tse = tse_rows()
    deputies = [p for p in people if p["office"] == "deputado-federal" and p["status"] in ("elected", "projected")]
    rows = []
    for p in deputies:
        r = tse.get(("deputado-federal", p["uf"], p["number"]))
        race = RACE.get((r or {}).get("DS_COR_RACA", "").upper())
        rows.append(
            {
                "party": p["party"],
                "uf": p["uf"],
                "path": path(p),
                "female": bool(p.get("feminine")),
                "age": p["age"],
                "education": p["education"],
                "occupation": p["occupation"],
                "race": race,
            }
        )
    senators = [p for p in people if p["office"] == "senador" and p["status"] == "elected"]
    data = {
        "deputies": rows,
        "senate": {
            "elected": len(senators),
            "reelected": sum(reelected(p) for p in senators),
            "women": sum(bool(p.get("feminine")) for p in senators),
        },
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(rows)} deputies → {OUT.relative_to(ROOT)}")
    for key in ("path", "female", "race", "education"):
        print(f"  {key}: {dict(Counter(r[key] for r in rows))}")
    print(f"  senate: {data['senate']}")


if __name__ == "__main__":
    main()
