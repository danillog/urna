"""Poverty in people, not percent, for the motion "Os pobres que o mapa esconde".

    uv run python motion/scripts/pobreza_absoluta.py     (from the repository root)

Writes motion/data/pobreza-absoluta.json from the files pipeline.americas.indicators cached:
- World Bank PIP at US$ 8.30 a day (2021 PPP), income surveys (Argentina urban only, as on
  the site): each country's latest survey up to the year, no older than the site's maxAge;
  people = headcount × the survey's reporting population.
- US Census Bureau SAIPE: people below the US official poverty line, the country and each
  state (all ages), from the yearly files.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "americas" / "indicators"
GEN = ROOT / "data" / "generated"
OUT = ROOT / "motion" / "data" / "pobreza-absoluta.json"
YEAR = 2024
MAX_AGE = 4
URBAN_ONLY = {"ARG"}


def latest_pip() -> list[dict]:
    names = {k: v["name"] for k, v in json.loads((GEN / "americas.json").read_text())["countries"].items()}
    best: dict[str, dict] = {}
    for r in json.loads((RAW / "pip-8.3.json").read_text()):
        iso = r["country_code"]
        level = "urban" if iso in URBAN_ONLY else "national"
        year = int(r["reporting_year"])
        if iso not in names or r["welfare_type"] != "income" or r["reporting_level"] != level:
            continue
        if r["headcount"] is None or year > YEAR or YEAR - year > MAX_AGE:
            continue
        if iso not in best or year > best[iso]["year"]:
            best[iso] = {
                "iso": iso,
                "name": names[iso],
                "year": year,
                "rate": round(r["headcount"] * 100, 1),
                "population": round(r["reporting_pop"]),
                "poor": round(r["headcount"] * r["reporting_pop"]),
                "urbanOnly": iso in URBAN_ONLY,
            }
    return sorted(best.values(), key=lambda c: -c["poor"])


def saipe(year: int) -> tuple[dict, list[dict]]:
    """The US row and the states: number in poverty and rate, all ages (columns 3 and 6)."""
    country, states = None, []
    for line in (RAW / f"saipe-{year}.txt").read_text(encoding="latin-1").splitlines():
        fips_state, fips_county = line[0:2], line[3:6].strip()
        if fips_county != "0":
            continue
        parts = line.split()
        row = {"poor": int(parts[2]), "rate": float(parts[5]), "name": line[193:].split("  ")[0].strip()}
        if fips_state == "00":
            country = row
        else:
            states.append(row)
    return country, sorted(states, key=lambda s: -s["poor"])


def main() -> None:
    countries = latest_pip()
    us_official, states = saipe(YEAR)
    out = {
        "year": YEAR,
        "line": "US$ 8,30 por dia (PPC 2021)",
        "countries": countries,
        "usOfficial": {**us_official, "series": {y: saipe(y)[0] for y in range(2004, YEAR + 1)}},
        "states": states,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for c in countries:
        print(f"  {c['name']:22} {c['year']}  {c['rate']:5.1f}%  {c['poor'] / 1e6:6.2f} mi  (pop {c['population'] / 1e6:.1f} mi)")
    print("US official", us_official)
    for s in states[:8]:
        print("  ", s)


if __name__ == "__main__":
    main()
