"""Builds data/generated/americas.json: who won each country's elections, and their family.

    uv run python -m pipeline.americas.build

Inputs: data/americas/elections.yaml (from pipeline.americas.discover, corrected by
hand in corrections.yaml) and the party families resolved by pipeline.americas.ideology.
"""

from __future__ import annotations

import json
import re
import sys

import yaml

from ..build import DATA
from .discover import COUNTRIES
from .ideology import FAMILIES, resolve_all

ELECTIONS = DATA / "americas" / "elections.yaml"
OUTPUT = DATA / "generated" / "americas.json"

NAMES = {
    "ARG": "Argentina",
    "ATG": "Antígua e Barbuda",
    "BHS": "Bahamas",
    "BLZ": "Belize",
    "BOL": "Bolívia",
    "BRA": "Brasil",
    "BRB": "Barbados",
    "CAN": "Canadá",
    "CHL": "Chile",
    "COL": "Colômbia",
    "CRI": "Costa Rica",
    "CUB": "Cuba",
    "DMA": "Dominica",
    "DOM": "República Dominicana",
    "ECU": "Equador",
    "GRD": "Granada",
    "GTM": "Guatemala",
    "GUY": "Guiana",
    "HND": "Honduras",
    "HTI": "Haiti",
    "JAM": "Jamaica",
    "KNA": "São Cristóvão e Névis",
    "LCA": "Santa Lúcia",
    "MEX": "México",
    "NIC": "Nicarágua",
    "PAN": "Panamá",
    "PER": "Peru",
    "PRY": "Paraguai",
    "SLV": "El Salvador",
    "SUR": "Suriname",
    "TTO": "Trinidad e Tobago",
    "URY": "Uruguai",
    "USA": "Estados Unidos",
    "VCT": "São Vicente e Granadinas",
    "VEN": "Venezuela",
    # Territories, drawn for context.
    "ABW": "Aruba",
    "AIA": "Anguila",
    "BLM": "São Bartolomeu",
    "BMU": "Bermudas",
    "CUW": "Curaçao",
    "CYM": "Ilhas Cayman",
    "FLK": "Ilhas Malvinas",
    "GUF": "Guiana Francesa",
    "MAF": "São Martinho",
    "MSR": "Montserrat",
    "PRI": "Porto Rico",
    "SPM": "São Pedro e Miquelão",
    "SXM": "Sint Maarten",
    "TCA": "Ilhas Turcas e Caicos",
    "VGB": "Ilhas Virgens Britânicas",
    "VIR": "Ilhas Virgens Americanas",
}
# No competitive elections: drawn in gray with an explanation instead of a result.
NON_COMPETITIVE = {"CUB"}


def main() -> int:
    elections = yaml.safe_load(ELECTIONS.read_text(encoding="utf-8"))
    families = resolve_all()
    countries: dict = {}
    for iso, entries in elections.items():
        out = []
        for e in entries:
            annulled = e.get("status") == "annulled"
            party = re.sub(r"\s*\([^)]*\)$", "", e.get("party") or "") or None  # "Morena (political party)"
            rec = {
                "date": e["date"],
                "article": e["article"],
                "winner": None if annulled else e.get("winner"),
                "party": None if annulled else party,
                "status": e.get("status"),
            }
            if e.get("status") != "annulled":
                key = e.get("party_article") or e["party"]
                fam = families[iso].get(key) or families[iso].get(e["party"])
                if not fam:
                    print(
                        f"error: {iso} {e['article']}: no family for {key!r} in parties.yaml", file=sys.stderr
                    )
                    return 1
                rec |= {"family": fam.family, "familySource": fam.source}
            out.append({k: v for k, v in rec.items() if v is not None})
        countries[iso] = {"name": NAMES[iso], "system": COUNTRIES[iso][1], "elections": out}
    for iso in NON_COMPETITIVE:
        countries[iso] = {"name": NAMES[iso], "system": "non-competitive", "elections": []}
    territories = {iso: NAMES[iso] for iso in NAMES if iso not in countries}
    data = {"families": list(FAMILIES), "countries": countries, "territories": territories}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    n = sum(len(c["elections"]) for c in countries.values())
    print(f"wrote {OUTPUT.relative_to(DATA.parent)}: {len(countries)} countries, {n} elections")
    return 0


if __name__ == "__main__":
    sys.exit(main())
