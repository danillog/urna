"""Writes motion/data/argentina.json, for the video "Como o IDH da Argentina é tão alto?".

    uv run python motion/scripts/argentina.py     (from the repository root)

Reads the files pipeline.americas.indicators caches in data/raw/americas/indicators/:
- hdi.csv (UNDP, HDR 2025 composite indices): HDI and its three components, the
  inequality-adjusted HDI, and gross national income per person (2021 PPP dollars);
- pip.json (World Bank, Poverty and Inequality Platform, $3 a day line): extreme poverty,
  median income per person per day (2021 PPP dollars) and Gini. Argentina's survey covers
  urban areas only.
The component indices follow the HDR technical notes: life expectancy 20–85 years;
expected schooling capped at 18 and mean schooling at 15; income on a log scale 100–75,000.

Argentina's own poverty rate (INDEC, Encuesta Permanente de Hogares, share of people
below the basic basket line) is not in those files and is written here by hand.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "americas" / "indicators"
OUT = ROOT / "motion" / "data" / "argentina.json"
COUNTRIES = ["ARG", "BRA"]
FIRST = 2000

# INDEC, "Incidencia de la pobreza y la indigencia", 31 aglomerados urbanos, people.
INDEC = [
    {"period": "2º sem. 2023", "poverty": 41.7},
    {"period": "1º sem. 2024", "poverty": 52.9},
    {"period": "2º sem. 2024", "poverty": 38.1},
    {"period": "1º sem. 2025", "poverty": 31.6},
]


def health(le: float) -> float:
    return (le - 20) / 65


def education(eys: float, mys: float) -> float:
    return (min(eys, 18) / 18 + min(mys, 15) / 15) / 2


def income(gni: float) -> float:
    return (math.log(gni) - math.log(100)) / (math.log(75000) - math.log(100))


def num(v: str) -> float | None:
    return float(v) if v not in ("", None) else None


def main() -> None:
    with (RAW / "hdi.csv").open(encoding="utf-8-sig", errors="replace") as f:
        rows = {r["iso3"]: r for r in csv.DictReader(f) if r["iso3"] in COUNTRIES}
    last = max(int(k.split("_")[1]) for k in rows["ARG"] if k.startswith("hdi_") and k[4:].isdigit() and rows["ARG"][k])
    pip = json.loads((RAW / "pip.json").read_text())

    out: dict = {"lastYear": last, "indec": INDEC, "countries": {}}
    for iso in COUNTRIES:
        r = rows[iso]
        le, eys, mys, gni = (float(r[f"{k}_{last}"]) for k in ("le", "eys", "mys", "gnipc"))
        series = {
            key: [num(r.get(f"{key}_{y}", "")) for y in range(FIRST, last + 1)] for key in ("hdi", "gnipc")
        }
        surveys = sorted(
            (p for p in pip if p["country_code"] == iso and p["reporting_level"] in ("national", "urban")),
            key=lambda p: p["reporting_year"],
        )
        survey = {
            p["reporting_year"]: {
                "extreme": round(p["headcount"] * 100, 1),
                "median": round(p["median"], 2),
                "gini": round(p["gini"], 3),
            }
            for p in surveys
        }
        out["countries"][iso] = {
            "hdi": float(r[f"hdi_{last}"]),
            "rank": int(r[f"hdi_rank_{last}"]),
            "ihdi": float(r[f"ihdi_{last}"]),
            "le": round(le, 1),
            "eys": round(eys, 1),
            "mys": round(mys, 1),
            "gnipc": round(gni),
            "index": {
                "health": round(health(le), 3),
                "education": round(education(eys, mys), 3),
                "income": round(income(gni), 3),
            },
            "series": series,
            "survey": survey,
        }
    out["firstYear"] = FIRST
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    a = out["countries"]["ARG"]
    check = (a["index"]["health"] * a["index"]["education"] * a["index"]["income"]) ** (1 / 3)
    print(f"{OUT.relative_to(ROOT)}: ARG HDI {a['hdi']} (from components: {check:.3f}), rank {a['rank']}")


if __name__ == "__main__":
    main()
