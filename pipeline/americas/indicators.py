"""Builds data/generated/americas-indicators.json: yearly country indicators for the map.

    uv run python -m pipeline.americas.indicators

- Human Development Index: UNDP, Human Development Report 2025, composite indices
  time series (1990–2023).
- GDP per capita, PPP (constant 2021 international $): World Bank, NY.GDP.PCAP.PP.KD.
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
GDP_URL = (
    "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.PP.KD"
    "?format=json&date=2000:2026&per_page=20000"
)
DEMOCRACY_URL = (
    "https://ourworldindata.org/grapher/electoral-democracy-index.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)

SOURCES = {
    "hdi": {
        "source": "PNUD, Relatório de Desenvolvimento Humano 2025",
        "url": "https://hdr.undp.org/data-center/documentation-and-downloads",
    },
    "gdp": {
        "source": "Banco Mundial (NY.GDP.PCAP.PP.KD), dólares internacionais constantes de 2021",
        "url": "https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.KD",
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


def gdp() -> dict[str, dict[int, float]]:
    _, records = json.loads(cached("gdp.json", GDP_URL))
    out: dict[str, dict[int, float]] = {}
    for r in records:
        if r["value"] is not None:
            out.setdefault(r["countryiso3code"], {})[int(r["date"])] = float(r["value"])
    return out


def democracy() -> dict[str, dict[int, float]]:
    rows = csv.DictReader(io.StringIO(cached("democracy.csv", DEMOCRACY_URL).decode("utf-8")))
    out: dict[str, dict[int, float]] = {}
    for r in rows:
        if r["code"] and r["electdem_vdem__estimate_best"]:
            out.setdefault(r["code"], {})[int(r["year"])] = float(r["electdem_vdem__estimate_best"])
    return out


def main() -> int:
    loaders = {"hdi": hdi, "gdp": gdp, "democracy": democracy}
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
                    round(series[y], 3 if key != "gdp" else 0) if y in series else None for y in years
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
