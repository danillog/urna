"""Builds data/generated/americas.json: who won each country's elections, and their family.

    uv run python -m pipeline.americas.build

Inputs: data/americas/elections.yaml (from pipeline.americas.discover, corrected by
hand in corrections.yaml) and the party families resolved by pipeline.americas.ideology.
"""

from __future__ import annotations

import csv
import json
import re
import sys

import yaml

from ..build import DATA
from .discover import CORRECTIONS, COUNTRIES
from .ideology import FAMILIES, resolve_all
from .regions import ALIASES, find_table, region_index, surname_tokens

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


# Brazil comes from the TSE files already used by the municipality map (official,
# and more reliable than the Wikipedia tables).
TSE_DIR = DATA / "raw" / "tse"
SCALE = 10  # shares are stored in tenths of a percent


def tokens(name: str) -> set[str]:
    return surname_tokens(name)


CANDIDATES = DATA / "americas" / "candidates.yaml"


def label_family(
    label: str, e: dict, iso: str, families: dict, national: str, extra: dict[str, str]
) -> tuple[str, str | None]:
    """Display name and family for a table column: the national winner's own family, the
    family of the infobox candidate (alliance first, then party) the label names, or of a
    candidate listed in candidates.yaml."""
    if tokens(label) & tokens(e["winner"]):
        return e["winner"], national
    for surname, party in extra.items():
        if tokens(surname) <= tokens(label) and party in families[iso]:
            return label, families[iso][party].family
    for c in e.get("candidates", []):
        if tokens(label) & tokens(c["name"]):
            for key in (c.get("alliance_article"), c.get("alliance"), c.get("party_article"), c.get("party")):
                if key and key in families[iso]:
                    return c["name"], families[iso][key].family
            return c["name"], None
    return label, None


def brazil_regions(year: str, national_family: str, families: dict) -> dict | None:
    """Presidential result by state from the TSE files (runoff when there was one)."""
    path = TSE_DIR / f"results_{year}.csv"
    if not path.exists():
        return None
    votes: dict[str, dict[str, dict[str, int]]] = {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["office"] != "president" or row["state"] in ("ZZ", "VT"):
                continue
            by_party = votes.setdefault(row["round"], {}).setdefault(row["state"], {})
            by_party[row["party"]] = by_party.get(row["party"], 0) + int(row["votes"])
    final = votes.get("2") or votes["1"]
    parties = sorted(
        {p for st in final.values() for p in st}, key=lambda p: -sum(st.get(p, 0) for st in final.values())
    )
    labels = []
    for party in parties:
        fam = families["BRA"].get(party)
        labels.append({"name": party, "family": fam.family if fam else None})
    regions = {}
    for uf, by_party in final.items():
        total = sum(by_party.values())
        ranked = sorted(by_party.items(), key=lambda kv: -kv[1])
        (w, wv), (r, rv) = ranked[0], ranked[1]
        regions[f"BR-{uf}"] = [
            parties.index(w),
            round(wv / total * 100 * SCALE),
            parties.index(r),
            round(rv / total * 100 * SCALE),
        ]
    return {"regionCandidates": labels, "regions": regions, "regionSource": "TSE"}


def wikipedia_regions(
    iso: str, e: dict, national_family: str, families: dict, aliases: dict, extra: dict[str, str]
) -> dict | None:
    index = region_index(iso, aliases)
    n_regions = len({c for codes in index.values() for c in codes})
    table = find_table(e, index, n_regions)
    if not table:
        return None
    labels = [label_family(c, e, iso, families, national_family, extra) for c in table.candidates]
    regions = {}
    for code, votes in table.rows.items():
        total = sum(votes)
        if not total:
            continue
        pct = table.percents.get(code) or [None] * len(votes)
        share = [p if p is not None else v / total * 100 for v, p in zip(votes, pct, strict=True)]
        order = sorted(range(len(votes)), key=lambda k: -votes[k])
        w, r = order[0], order[1]
        regions[code] = [w, round(share[w] * SCALE), r, round(share[r] * SCALE)]
    return {
        "regionCandidates": [{"name": n, "family": f} for n, f in labels],
        "regions": regions,
        "regionSource": table.source,
    }


def main() -> int:
    elections = yaml.safe_load(ELECTIONS.read_text(encoding="utf-8"))
    corrections = yaml.safe_load(CORRECTIONS.read_text(encoding="utf-8"))
    no_regions = set(corrections.get("no_regions") or [])
    aliases = yaml.safe_load(ALIASES.read_text(encoding="utf-8")) or {}
    families = resolve_all()
    extra = yaml.safe_load(CANDIDATES.read_text(encoding="utf-8")) or {}
    unresolved: list[str] = []
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
            if not annulled:
                key = e.get("party_article") or e["party"]
                fam = families[iso].get(key) or families[iso].get(e["party"])
                if not fam:
                    print(
                        f"error: {iso} {e['article']}: no family for {key!r} in parties.yaml", file=sys.stderr
                    )
                    return 1
                rec |= {"family": fam.family, "familySource": fam.source}
                if e["article"] not in no_regions:
                    if iso == "BRA":
                        regional = brazil_regions(e["date"][:4], fam.family, families)
                    else:
                        regional = wikipedia_regions(
                            iso, e, fam.family, families, aliases, extra.get(iso, {})
                        )
                    if regional:
                        rec |= regional
                        winners = {v[0] for v in regional["regions"].values()}
                        for k in winners:
                            c = regional["regionCandidates"][k]
                            if c["family"] is None:
                                unresolved.append(f"{iso} {e['date'][:4]}: {c['name']}")
            out.append({k: v for k, v in rec.items() if v is not None})
        countries[iso] = {"name": NAMES[iso], "system": COUNTRIES[iso][1], "elections": out}
    for iso in NON_COMPETITIVE:
        countries[iso] = {"name": NAMES[iso], "system": "non-competitive", "elections": []}
    territories = {iso: NAMES[iso] for iso in NAMES if iso not in countries}
    data = {"families": list(FAMILIES), "countries": countries, "territories": territories}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    n = sum(len(c["elections"]) for c in countries.values())
    with_regions = sum(1 for c in countries.values() for e in c["elections"] if "regions" in e)
    print(
        f"wrote {OUTPUT.relative_to(DATA.parent)}: {len(countries)} countries, {n} elections, "
        f"{with_regions} with results by state/province"
    )
    if unresolved:
        print(
            "regional winners without a family (add them to data/americas/parties.yaml):",
            *sorted(set(unresolved)),
            sep="\n  ",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
