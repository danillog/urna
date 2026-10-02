"""Builds data/generated/americas-indicators.json: yearly country indicators for the map.

    uv run python -m pipeline.americas.indicators

- Human Development Index: UNDP, Human Development Report 2025, composite indices
  time series (1990–2023).
- Median income per person, from household surveys (2021 PPP $, per month): World Bank
  Poverty and Inequality Platform. Income surveys only (consumption surveys measure
  something else); national coverage, except Argentina's urban-only survey.
- Electoral democracy index: V-Dem (v2x_polyarchy), via Our World in Data.

Downloads are cached in data/raw/americas/indicators/.
"""

from __future__ import annotations

import csv
import io
import json
import sys

from ..build import DATA
from ..sources.http import get
from .geo import COUNTRIES

CACHE = DATA / "raw" / "americas" / "indicators"
OUTPUT = DATA / "generated" / "americas-indicators.json"
FIRST_YEAR = 2000

HDI_URL = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv"
PIP_URL = "https://api.worldbank.org/pip/v1/pip?country=all&year=all&povline=3&fill_gaps=false&format=json"
DAYS_PER_MONTH = 365.25 / 12
# Argentina's EPH covers only urban areas; there is no national series.
URBAN_ONLY = {"ARG"}
DEMOCRACY_URL = (
    "https://ourworldindata.org/grapher/electoral-democracy-index.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)

SOURCES = {
    "hdi": {
        "source": "PNUD, Relatório de Desenvolvimento Humano 2025",
        "url": "https://hdr.undp.org/data-center/documentation-and-downloads",
    },
    "income": {
        "source": "Banco Mundial, Poverty and Inequality Platform: renda mediana por pessoa nas "
        "pesquisas domiciliares, em dólares de paridade de poder de compra de 2021, por mês",
        "url": "https://pip.worldbank.org/",
        # Surveys are not yearly everywhere; older than this, a value says little about now.
        "maxAge": 4,
        "urbanOnly": sorted(URBAN_ONLY),
    },
    "democracy": {
        "source": "V-Dem, índice de democracia eleitoral (v2x_polyarchy), via Our World in Data",
        "url": "https://ourworldindata.org/grapher/electoral-democracy-index",
    },
}


def cached(name: str, url: str) -> bytes:
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(url))
    return path.read_bytes()


def hdi() -> dict[str, dict[int, float]]:
    rows = csv.DictReader(io.StringIO(cached("hdi.csv", HDI_URL).decode("utf-8-sig", errors="replace")))
    out: dict[str, dict[int, float]] = {}
    for r in rows:
        series = {
            int(k[4:]): float(v) for k, v in r.items() if k.startswith("hdi_") and k[4:].isdigit() and v
        }
        out[r["iso3"]] = series
    return out


def income() -> dict[str, dict[int, float]]:
    """Monthly median income per person; PIP gives it per day."""
    out: dict[str, dict[int, float]] = {}
    for r in json.loads(cached("pip.json", PIP_URL)):
        level = "urban" if r["country_code"] in URBAN_ONLY else "national"
        if r["welfare_type"] != "income" or r["reporting_level"] != level or r["median"] is None:
            continue
        out.setdefault(r["country_code"], {})[int(r["reporting_year"])] = r["median"] * DAYS_PER_MONTH
    return out


def democracy() -> dict[str, dict[int, float]]:
    rows = csv.DictReader(io.StringIO(cached("democracy.csv", DEMOCRACY_URL).decode("utf-8")))
    out: dict[str, dict[int, float]] = {}
    for r in rows:
        if r["code"] and r["electdem_vdem__estimate_best"]:
            out.setdefault(r["code"], {})[int(r["year"])] = float(r["electdem_vdem__estimate_best"])
    return out


def main() -> int:
    loaders = {"hdi": hdi, "income": income, "democracy": democracy}
    out: dict = {"firstYear": FIRST_YEAR, "indicators": {}}
    for key, load in loaders.items():
        data = load()
        last = max(y for iso in COUNTRIES for y in data.get(iso, {}))
        years = range(FIRST_YEAR, last + 1)
        values = {}
        for iso in COUNTRIES:
            series = data.get(iso, {})
            if series:
                # One value per year from FIRST_YEAR; null where the source has none.
                values[iso] = [
                    round(series[y], 3 if key != "income" else 0) if y in series else None for y in years
                ]
        out["indicators"][key] = {**SOURCES[key], "lastYear": last, "values": values}
        missing = [iso for iso in COUNTRIES if iso not in values]
        print(
            f"{key}: {len(values)} countries, {FIRST_YEAR}–{last}"
            + (f"; no data for {missing}" if missing else "")
        )
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
