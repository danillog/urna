"""Writes motion/data/ideologia.json: the members in office, by their votes and by their party's label.

    uv run python motion/scripts/ideologia.py

Positions come from data/generated/ideology.json (pipeline/ideology.py: first principal
component of the term's contested roll calls, −1…+1 within each house). The Chamber is cut
to the deputies sitting today (situação "Exercício" in the Câmara's list that
pipeline.profiles caches in data/raw/profiles/camara_deputados.json), each with the party
they are in today; those in office but placed by too few votes are only counted. The
Senate keeps every senator placed in the term. Each party's label (score and group) is
the one the Congress tab uses for the legislature in office (data/generated/congress.json,
"now": Zucco & Power). Only ids, names, parties, states and positions are read; no CPF is
written out. The last day with votes is pipeline.mandate's (data/generated/mandate.json).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pipeline.congress import acronym  # noqa: E402

GENERATED = ROOT / "data" / "generated"
CAMARA = ROOT / "data" / "raw" / "profiles" / "camara_deputados.json"
OUT = ROOT / "motion" / "data" / "ideologia.json"


def member(m: dict, party: str) -> dict:
    return {"name": m["name"], "party": party, "uf": m["uf"], "score": m["score"]}


def main() -> None:
    ideology = json.loads((GENERATED / "ideology.json").read_text(encoding="utf-8"))
    congress = json.loads((GENERATED / "congress.json").read_text(encoding="utf-8"))
    camara = json.loads(CAMARA.read_text(encoding="utf-8"))
    until = json.loads((GENERATED / "mandate.json").read_text(encoding="utf-8"))["until"]

    sitting = {
        str(d["id"]): d["ultimoStatus"]
        for d in camara.values()
        if (d.get("ultimoStatus") or {}).get("idLegislatura") == 57
        and d["ultimoStatus"].get("situacao") == "Exercício"
    }
    placed = ideology["chamber"]["members"]
    chamber = [member(placed[i], acronym(s["siglaPartido"])) for i, s in sitting.items() if i in placed]
    senate = list(ideology["senate"]["members"].values())

    labels: dict[str, dict] = {}
    for house in ("senate", "chamber"):  # the Chamber's wins where both list a party
        for p in congress["now"][house]["parties"]:
            if p.get("group"):
                labels[p["party"]] = {"score": p["score"], "group": p["group"]}

    out = {
        "since": ideology["since"],
        "until": until,
        "date": congress["now"]["date"],
        "minVotes": ideology["minVotes"],
        "chamber": {
            "inOffice": len(sitting),
            "r": ideology["chamber"]["validation"]["r"],
            "members": sorted(chamber, key=lambda m: m["score"]),
        },
        "senate": {
            "r": ideology["senate"]["validation"]["r"],
            "members": sorted((member(m, m["party"]) for m in senate), key=lambda m: m["score"]),
        },
        "labels": labels,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT}: {len(chamber)} of {len(sitting)} deputies, {len(senate)} senators")


if __name__ == "__main__":
    main()
