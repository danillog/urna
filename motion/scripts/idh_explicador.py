"""Writes motion/data/idh-explicador.json, for the video "O que é o IDH?".

    uv run python motion/scripts/idh_explicador.py     (from the repository root)

Reads the UNDP file pipeline.americas.indicators caches (data/raw/americas/indicators/hdi.csv,
HDR 2025 composite indices) and keeps, for the last year: a few countries that show what
each level of the scale looks like (life expectancy, mean years of schooling of adults,
income per person in 2021 PPP dollars), the highest and lowest country, and the world.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "americas" / "indicators" / "hdi.csv"
OUT = ROOT / "motion" / "data" / "idh-explicador.json"

# One country per step of the scale, picked near 0.40, 0.50, 0.60, 0.70, Brazil, 0.90.
ANCHORS = {"TCD": "Chade", "ETH": "Etiópia", "KHM": "Camboja", "IRQ": "Iraque", "BRA": "Brasil", "POL": "Polônia"}
NAMES = {"ISL": "Islândia", "SSD": "Sudão do Sul", "CHE": "Suíça", "NOR": "Noruega"}


def main() -> None:
    with RAW.open(encoding="utf-8-sig", errors="replace") as f:
        rows = list(csv.DictReader(f))
    last = max(int(k[4:]) for k in rows[0] if k.startswith("hdi_") and k[4:].isdigit())
    first = min(int(k[4:]) for k in rows[0] if k.startswith("hdi_") and k[4:].isdigit())
    countries = [r for r in rows if len(r["iso3"]) == 3 and r[f"hdi_{last}"]]

    def card(r: dict, name: str) -> dict:
        return {
            "iso": r["iso3"],
            "name": name,
            "hdi": float(r[f"hdi_{last}"]),
            "le": round(float(r[f"le_{last}"]), 1),
            "mys": round(float(r[f"mys_{last}"]), 1),
            "gnipc": round(float(r[f"gnipc_{last}"])),
        }

    by_iso = {r["iso3"]: r for r in countries}
    top = max(countries, key=lambda r: float(r[f"hdi_{last}"]))
    bottom = min(countries, key=lambda r: float(r[f"hdi_{last}"]))
    world = next(r for r in rows if r["iso3"] == "ZZK.WORLD")
    brazil = by_iso["BRA"]
    out = {
        "year": last,
        "firstYear": first,
        "count": len(countries),
        "anchors": [card(by_iso[iso], name) for iso, name in ANCHORS.items()],
        "top": card(top, NAMES.get(top["iso3"], top["country"])),
        "bottom": card(bottom, NAMES.get(bottom["iso3"], bottom["country"])),
        "world": {"first": float(world[f"hdi_{first}"]), "last": float(world[f"hdi_{last}"])},
        "brazilRank": int(brazil[f"hdi_rank_{last}"]),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(out['anchors'])} anchors, {out['count']} countries, {last}")


if __name__ == "__main__":
    main()
