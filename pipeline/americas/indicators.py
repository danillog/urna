"""Builds data/generated/americas-indicators.json: yearly country indicators for the map.

    uv run python -m pipeline.americas.indicators

- Human Development Index: UNDP, Human Development Report 2025, composite indices
  time series (1990–2023).
- Median income per person, from household surveys (2021 PPP $, per month): World Bank
  Poverty and Inequality Platform. Income surveys only (consumption surveys measure
  something else); national coverage, except Argentina's urban-only survey.
- Poverty: share of people living on less than $8.30 a day (2021 PPP), the World Bank's
  line for upper-middle-income countries, most of Latin America. Same platform and same
  surveys as the median income (income surveys, Argentina urban only).
  Where a country has no income survey recent enough (Caribbean states, Suriname, …), the
  map falls back on the platform's latest survey of any kind, consumption included, up to
  FALLBACK_MAX_AGE years old, and marks it; countries with nothing usable get a one-line
  reason (missingWhy).
- The United States by state, for the tooltip only: the Census Bureau's official poverty rate
  (SAIPE, all ages). It uses the US line, several times the World Bank's, so it says how
  states compare with each other, not with the rest of the continent; the map's color stays
  the World Bank's national figure.
- Electoral democracy index: V-Dem (v2x_polyarchy), via Our World in Data.
- Food insecurity: FAO, prevalence of moderate or severe food insecurity in the population
  (Food Insecurity Experience Scale, SDG 2.1.2), FAOSTAT's 3-year averages, each stored at its
  centre year (2014–2016 → 2015). Countries FAO does not publish get a reason (missingWhy).
  For the tooltip only, as the US poverty rate: the United States by state (USDA, Economic
  Research Service, share of households food insecure, 3-year averages from the last report,
  Household Food Security in the United States in 2024, read from its PDF with pdftotext;
  the series was discontinued after it) and Brazil by state (IBGE, EBIA: households in
  moderate or severe food insecurity, PNAD 2004 and PNAD Contínua 2023–2024, via SIDRA).
  Both count households on their own scales: comparable within the country, not with FAO's.

Brazil's HDI is also given by state: the IDHM of the Atlas of Human Development in
Brazil (PNUD, Ipea, FJP), via Ipeadata.

Downloads are cached in data/raw/americas/indicators/.
"""

from __future__ import annotations

import csv
import functools
import io
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import zipfile

from ..build import DATA
from ..sources.http import get
from ..sources.ipea import UF_BY_CODE, by_territory
from .geo import COUNTRIES

CACHE = DATA / "raw" / "americas" / "indicators"
OUTPUT = DATA / "generated" / "americas-indicators.json"
FIRST_YEAR = 2000

HDI_URL = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv"
PIP_URL = "https://api.worldbank.org/pip/v1/pip?country=all&year=all&povline=3&fill_gaps=false&format=json"
POVERTY_LINE = 8.3
POVERTY_URL = f"https://api.worldbank.org/pip/v1/pip?country=all&year=all&povline={POVERTY_LINE}&fill_gaps=false&format=json"
DAYS_PER_MONTH = 365.25 / 12
# Older than this, even a fallback survey is left out: a country is shown blank instead.
FALLBACK_MAX_AGE = 10
# Census Bureau, Small Area Income and Poverty Estimates: one fixed-width file per year,
# .txt or (older years) .dat. The API now asks for a key; the files do not.
SAIPE_URL = (
    "https://www2.census.gov/programs-surveys/saipe/datasets/{year}/{year}-state-and-county/est{yy}all.{ext}"
)
# State FIPS code → postal code, as the map's regions are named (US-XX).
FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
    "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
    "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY",
}  # fmt: skip
# Blank countries whose reason the data cannot tell.
MISSING_WHY = {
    "VEN": "O Banco Mundial não tem pesquisa de renda da Venezuela desde 2006, antes da crise; "
    "um dado de 20 anos atrás diria pouco sobre hoje.",
    "CUB": "Cuba não publica pesquisas domiciliares de renda.",
}
AMERICAS = DATA / "generated" / "americas.json"
# Argentina's EPH covers only urban areas; there is no national series.
URBAN_ONLY = {"ARG"}
DEMOCRACY_URL = (
    "https://ourworldindata.org/grapher/electoral-democracy-index.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)

# FAOSTAT's Food Security bulk file; item 210091 is the moderate-or-severe prevalence in the
# total population, as 3-year averages ("2014-2016").
FAO_URL = "https://bulks-faostat.fao.org/production/Food_Security_Data_E_All_Data_(Normalized).zip"
FAO_ITEM = "210091"
# ISO3 → UN M49 (FAOSTAT's area code), for the countries of the map.
M49 = {
    "ARG": "032", "ATG": "028", "BHS": "044", "BLZ": "084", "BOL": "068", "BRA": "076", "BRB": "052",
    "CAN": "124", "CHL": "152", "COL": "170", "CRI": "188", "CUB": "192", "DMA": "212", "DOM": "214",
    "ECU": "218", "GRD": "308", "GTM": "320", "GUY": "328", "HND": "340", "HTI": "332", "JAM": "388",
    "KNA": "659", "LCA": "662", "MEX": "484", "NIC": "558", "PAN": "591", "PER": "604", "PRY": "600",
    "SLV": "222", "SUR": "740", "TTO": "780", "URY": "858", "USA": "840", "VCT": "670", "VEN": "862",
}  # fmt: skip
# USDA ERS, the last Household Food Security report (ERR-358, December 2025). Table 5 gives each
# state's food insecurity for 2012–2014, 2019–2021 and 2022–2024; table 1, the country's by year.
USDA_URL = "https://www.ers.usda.gov/media/9161/err-358.pdf"
USDA_REPORT = "https://www.ers.usda.gov/publications/pub-details?pubid=113622"
# IBGE SIDRA: households by food security status (EBIA), percent. 3017: PNAD 2004 by state;
# 9552: PNAD Contínua (4th quarter) 2023 on, by state; 6665: SDG 2.1.2, Brazil, every survey.
# Moderate (109101) plus severe (109102).
SIDRA = "https://apisidra.ibge.gov.br/values"
SIDRA_TABLES = {
    "states-2004": "/t/3017/n3/all/v/1000800/p/2004/c12404/109101,109102",
    "states-pnadc": "/t/9552/n3/all/v/9784/p/all/c1/6795/c12404/109101,109102",
    "brazil": "/t/6665/n1/all/v/800/p/all/c12404/109101,109102",
}

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
    "poverty": {
        "source": "Banco Mundial, Poverty and Inequality Platform: pessoas vivendo com menos de "
        "US$ 8,30 por dia (dólares de paridade de poder de compra de 2021), a linha para países "
        "de renda média-alta",
        "url": "https://pip.worldbank.org/",
        "maxAge": 4,
        "urbanOnly": sorted(URBAN_ONLY),
    },
    "food": {
        "source": "FAO, prevalência de insegurança alimentar moderada ou grave na população (Escala "
        "de Experiência de Insegurança Alimentar, ODS 2.1.2): médias de 3 anos, cada uma mostrada "
        "no ano do meio (2022–2024 em 2023)",
        "url": "https://www.fao.org/faostat/en/#data/FS",
        "maxAge": 4,
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
    for r in income_surveys(cached("pip.json", PIP_URL)):
        if r["median"] is None:
            continue
        out.setdefault(r["country_code"], {})[int(r["reporting_year"])] = r["median"] * DAYS_PER_MONTH
    return out


def income_surveys(raw: bytes):
    """PIP rows from income surveys at the country's coverage (urban for Argentina)."""
    for r in json.loads(raw):
        level = "urban" if r["country_code"] in URBAN_ONLY else "national"
        if r["welfare_type"] == "income" and r["reporting_level"] == level:
            yield r


def poverty() -> dict[str, dict[int, float]]:
    """Share of people below the line, in percent."""
    out: dict[str, dict[int, float]] = {}
    for r in income_surveys(cached(f"pip-{POVERTY_LINE}.json", POVERTY_URL)):
        if r["headcount"] is not None:
            out.setdefault(r["country_code"], {})[int(r["reporting_year"])] = r["headcount"] * 100
    return out


def poverty_surveys() -> dict[str, list[dict]]:
    """Every PIP survey per country at the line, income or consumption, oldest first; when a
    year has both, the income one (the main series' kind)."""
    out: dict[str, dict[int, dict]] = {}
    for r in json.loads(cached(f"pip-{POVERTY_LINE}.json", POVERTY_URL)):
        level = "urban" if r["country_code"] in URBAN_ONLY else "national"
        if r["reporting_level"] != level or r["headcount"] is None:
            continue
        year = int(r["reporting_year"])
        found = out.setdefault(r["country_code"], {})
        if year in found and found[year]["welfare"] == "income":
            continue
        found[year] = {"year": year, "value": round(r["headcount"] * 100, 1), "welfare": r["welfare_type"]}
    return {iso: [by_year[y] for y in sorted(by_year)] for iso, by_year in out.items()}


def latest(series: dict[int, float] | list[dict], year: int, max_age: int) -> int | None:
    """The year of the newest value at or before `year`, if not older than max_age."""
    years = list(series) if isinstance(series, dict) else [s["year"] for s in series]
    found = max((y for y in years if y <= year), default=None)
    return found if found is not None and year - found <= max_age else None


def poverty_fallback(
    main: dict[str, dict[int, float]], surveys: dict[str, list[dict]], first: int, last: int, max_age: int
) -> dict[str, list[dict]]:
    """The surveys of the countries that, in some year, have no main value within max_age but
    a survey within FALLBACK_MAX_AGE: what the map shows for them, marked."""
    out = {}
    for iso in COUNTRIES:
        own = surveys.get(iso, [])
        gap = any(
            latest(main.get(iso, {}), y, max_age) is None and latest(own, y, FALLBACK_MAX_AGE) is not None
            for y in range(first, last + 1)
        )
        if gap:
            out[iso] = own
    return out


def poverty_missing(
    main: dict[str, dict[int, float]], surveys: dict[str, list[dict]], year: int, max_age: int
) -> dict[str, str]:
    """Why a country is blank in `year`: hand-written where the data cannot tell, else its
    last survey's year, or that there is none."""
    out = {}
    for iso in COUNTRIES:
        own = surveys.get(iso, [])
        shown = latest(main.get(iso, {}), year, max_age) or latest(own, year, FALLBACK_MAX_AGE)
        if shown is not None:
            continue
        # The tooltip's header names the country: no name here, so no article to get right.
        if iso in MISSING_WHY:
            out[iso] = MISSING_WHY[iso]
        elif own:
            out[iso] = (
                f"A última pesquisa do Banco Mundial aqui é de {own[-1]['year']}: "
                f"antiga demais para dizer algo sobre {year}."
            )
        else:
            out[iso] = "O Banco Mundial não tem nenhuma pesquisa domiciliar daqui para medir a pobreza."
    return out


def saipe_file(year: int) -> str | None:
    """One year's SAIPE file, cached; None when the year is not published. The site sometimes
    answers with a "request rejected" page (status 200) instead of a file: that is retried,
    then the year's other format tried, never cached."""
    for ext in ("txt", "dat"):
        path = CACHE / f"saipe-{year}.{ext}"
        if path.exists():
            return path.read_text(encoding="latin-1")
    missing = 0
    for ext in ("txt", "dat"):
        url = SAIPE_URL.format(year=year, yy=f"{year % 100:02d}", ext=ext)
        for attempt in range(3):
            try:
                text = get(url).decode("latin-1")
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    raise
                missing += 1
                break
            # Every file starts with the national row, state code 00.
            if text.lstrip().startswith("00"):
                CACHE.mkdir(parents=True, exist_ok=True)
                (CACHE / f"saipe-{year}.{ext}").write_text(text, encoding="latin-1")
                return text
            time.sleep(3 * (attempt + 1))
    if missing == 2:
        return None
    raise RuntimeError(f"SAIPE {year}: the Census site kept rejecting the request")


def us_official_poverty() -> dict[str, dict[int, float]]:
    """US-XX → the Census Bureau's poverty rate (all ages, percent) by year."""
    out: dict[str, dict[int, float]] = {}
    year = FIRST_YEAR
    while (text := saipe_file(year)) is not None:
        for code, rate in saipe_states(text).items():
            out.setdefault(code, {})[year] = rate
        year += 1
    return out


def saipe_states(text: str) -> dict[str, float]:
    """US-XX → poverty rate, all ages, from one SAIPE file (states only, not the counties)."""
    out = {}
    for line in text.splitlines():
        cols = line.split()
        # State rows: county code 0; the rate for all ages is the sixth column.
        if len(cols) > 5 and cols[1] == "0" and cols[0] in FIPS:
            out[f"US-{FIPS[cols[0]]}"] = float(cols[5])
    return out


def centre_year(period: str) -> int:
    """FAOSTAT's 3-year period, "2014-2016", → its middle year, 2015."""
    first, last = (int(y) for y in period.split("-"))
    return (first + last) // 2


@functools.cache
def fao_food() -> tuple[dict[str, dict[int, float]], frozenset[str], dict[str, frozenset[str]]]:
    """ISO3 → centre year → moderate-or-severe prevalence (percent); the countries FAO gives
    only as below its floor ("<2.5", kept at the floor); and the flags of each country's empty
    cells (Q: suppressed by FAO, O: no data)."""
    return parse_fao(cached("fao-food-security.zip", FAO_URL))


def parse_fao(raw: bytes) -> tuple[dict[str, dict[int, float]], frozenset[str], dict[str, frozenset[str]]]:
    by_m49 = {m49: iso for iso, m49 in M49.items()}
    values: dict[str, dict[int, float]] = {}
    floor: set[str] = set()
    flags: dict[str, set[str]] = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.endswith("(Normalized).csv"))
        for r in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1")):
            if r["Item Code"] != FAO_ITEM or r["Element"] != "Value":
                continue
            iso = by_m49.get(r["Area Code (M49)"].strip("'"))
            if iso is None:
                continue
            value = r["Value"].strip()
            if not value:
                flags.setdefault(iso, set()).add(r["Flag"])
                continue
            if value.startswith("<"):
                floor.add(iso)
                value = value[1:]
            values.setdefault(iso, {})[centre_year(r["Year"])] = float(value)
    return values, frozenset(floor), {iso: frozenset(f) for iso, f in flags.items()}


def food() -> dict[str, dict[int, float]]:
    return fao_food()[0]


def food_missing(
    values: dict[str, dict[int, float]], flags: dict[str, frozenset[str]], year: int, max_age: int
) -> dict[str, str]:
    """Why a country is blank in `year`: its last 3-year average is too old, FAO suppresses it,
    or FAO has nothing."""
    out = {}
    for iso in COUNTRIES:
        own = values.get(iso, {})
        if latest(own, year, max_age) is not None:
            continue
        if own:
            last = max(own)
            out[iso] = f"O último dado da FAO aqui é a média de {last - 1}–{last + 1}."
        elif "Q" in flags.get(iso, frozenset()):
            out[iso] = "A FAO não publica o dado deste país."
        else:
            out[iso] = "A FAO não tem medição de insegurança alimentar deste país."
    return out


def usda_text() -> str:
    """The last USDA report as text (pdftotext -layout), cached."""
    path = CACHE / "usda-err-358.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    if shutil.which("pdftotext") is None:
        raise RuntimeError("reading the USDA report needs pdftotext (poppler-utils)")
    pdf = cached("usda-err-358.pdf", USDA_URL)
    text = subprocess.run(["pdftotext", "-layout", "-", "-"], input=pdf, capture_output=True, check=True)
    path.write_text(text.stdout.decode("utf-8"), encoding="utf-8")
    return path.read_text(encoding="utf-8")


def table_lines(text: str, number: str) -> list[str]:
    """The lines of a report table, from its caption ("Table 5", alone on a line) to its note."""
    start = re.search(rf"^\W*Table {number}\s*$", text, re.M)
    if not start:
        raise ValueError(f"USDA report: no table {number}")
    lines = []
    for line in text[start.end() :].splitlines():
        if line.strip().startswith("Note:"):
            break
        lines.append(line)
    return lines


USDA_PERIODS = ["2012–2014", "2019–2021", "2022–2024"]


def usda_states(text: str) -> dict[str, list[float]]:
    """US-XX → share of households food insecure in each of USDA_PERIODS (table 5, whose columns
    run newest first)."""
    states = set(FIPS.values())
    out = {}
    for line in table_lines(text, "5"):
        m = re.match(r"\s*([A-Z]{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s", line)
        if m and m.group(1) in states:
            newest, middle, oldest = (float(m.group(k)) for k in (2, 3, 4))
            out[f"US-{m.group(1)}"] = [oldest, middle, newest]
    if len(out) != len(states):
        raise ValueError(f"USDA table 5: {len(out)} states read, {len(states)} expected")
    return out


def usda_national(text: str) -> dict[int, float]:
    """Year → share of US households food insecure (table 1A, households: the first block)."""
    out: dict[int, float] = {}
    for line in table_lines(text, "1A"):
        m = re.match(r"\s*(20\d\d)\s+[\d,]+\s+[\d,]+\s+[\d.]+\s+[\d,]+\s+([\d.]+)\s", line)
        if m:
            year = int(m.group(1))
            if year in out:  # the second block, individuals
                break
            out[year] = float(m.group(2))
    return out


def sidra(name: str) -> list[dict]:
    return json.loads(cached(f"sidra-food-{name}.json", SIDRA + SIDRA_TABLES[name]))


def ebia(rows: list[dict], place: str) -> dict[tuple[str, int], float]:
    """(place code, year) → households in moderate plus severe food insecurity (percent), from a
    SIDRA values response (its first row is the header)."""
    out: dict[tuple[str, int], float] = {}
    for r in rows[1:]:
        try:
            v = float(r["V"])
        except ValueError:
            continue
        key = (r[place], int(r["D3C"]))
        out[key] = out.get(key, 0.0) + v
    return {k: round(v, 1) for k, v in out.items()}


def brazil_food() -> tuple[list[int], dict[str, list[float | None]], dict[int, float]]:
    """IBGE's EBIA: the years with states, BR-XX → share per year, and Brazil's own series."""
    by_state = {**ebia(sidra("states-2004"), "D1C"), **ebia(sidra("states-pnadc"), "D1C")}
    years = sorted({y for _, y in by_state})
    states = {
        f"BR-{UF_BY_CODE[code]}": [by_state.get((code, y)) for y in years]
        for code in sorted({c for c, _ in by_state})
    }
    country = {y: v for (_, y), v in ebia(sidra("brazil"), "D1C").items()}
    return years, states, dict(sorted(country.items()))


def map_last_year(last: int) -> int:
    """The map's last year: the indicator's, or the last election's when that is later."""
    if not AMERICAS.exists():
        return last
    dates = [
        e["date"]
        for c in json.loads(AMERICAS.read_text(encoding="utf-8"))["countries"].values()
        for e in c["elections"]
    ]
    return max(last, int(max(dates)[:4]))


def add_food_extras(indicator: dict) -> None:
    """Below-floor countries, why the blank ones are blank, and the US and Brazil by state."""
    values, floor, flags = fao_food()
    map_last = map_last_year(indicator["lastYear"])
    indicator["belowFloor"] = sorted(floor & set(COUNTRIES))
    indicator["missingWhy"] = food_missing(values, flags, map_last, indicator["maxAge"])
    text = usda_text()
    indicator["usStates"] = {
        "source": "USDA, Economic Research Service, Household Food Security in the United States in 2024 "
        "(dezembro de 2025): domicílios em insegurança alimentar (baixa ou muito baixa segurança "
        "alimentar), médias de 3 anos. Escala e base (domicílios) próprias: compara os estados entre "
        "si, não com a FAO. O USDA encerrou a série depois deste relatório.",
        "url": USDA_REPORT,
        "periods": USDA_PERIODS,
        "values": usda_states(text),
    }
    indicator["usNational"] = usda_national(text)
    years, states, country = brazil_food()
    indicator["brStates"] = {
        "source": "IBGE, Escala Brasileira de Insegurança Alimentar (EBIA): domicílios em insegurança "
        "alimentar moderada ou grave. PNAD 2004 e PNAD Contínua (4º trimestre) de 2023 em diante, via "
        "SIDRA; escala e base (domicílios) próprias.",
        "url": "https://sidra.ibge.gov.br/tabela/9552",
        "years": years,
        "values": states,
    }
    indicator["brNational"] = country
    print(
        f"food: below FAO's floor {indicator['belowFloor']}; "
        f"blank in {map_last}: {sorted(indicator['missingWhy'])}; "
        f"US states {USDA_PERIODS[0]}–{USDA_PERIODS[-1]}; Brazil states {years}"
    )


def brazil_hdi_by_state() -> dict[str, dict[int, float]]:
    """IDHM by state: census years, then yearly from 2012."""
    return {f"BR-{UF_BY_CODE[code]}": series for code, series in by_territory("IDHM", "Estados").items()}


def democracy() -> dict[str, dict[int, float]]:
    rows = csv.DictReader(io.StringIO(cached("democracy.csv", DEMOCRACY_URL).decode("utf-8")))
    out: dict[str, dict[int, float]] = {}
    for r in rows:
        if r["code"] and r["electdem_vdem__estimate_best"]:
            out.setdefault(r["code"], {})[int(r["year"])] = float(r["electdem_vdem__estimate_best"])
    return out


def add_poverty_extras(indicator: dict, main: dict[str, dict[int, float]]) -> None:
    """Fallback surveys, why the blank countries are blank, and the US states' official rate."""
    surveys = poverty_surveys()
    map_last = map_last_year(indicator["lastYear"])
    indicator["fallbackMaxAge"] = FALLBACK_MAX_AGE
    indicator["fallback"] = poverty_fallback(main, surveys, FIRST_YEAR, map_last, indicator["maxAge"])
    indicator["missingWhy"] = poverty_missing(main, surveys, map_last, indicator["maxAge"])
    states = us_official_poverty()
    last_state = max(y for s in states.values() for y in s)
    indicator["officialByRegion"] = {
        code: [s.get(y) for y in range(FIRST_YEAR, last_state + 1)] for code, s in sorted(states.items())
    }
    indicator["officialSource"] = (
        "Census Bureau dos EUA, Small Area Income and Poverty Estimates (SAIPE): taxa oficial de "
        "pobreza, pela linha americana, bem mais alta que a do Banco Mundial"
    )
    indicator["officialUrl"] = "https://www.census.gov/programs-surveys/saipe.html"
    print(
        f"poverty: fallback for {sorted(indicator['fallback'])}; blank in {map_last}: "
        f"{sorted(indicator['missingWhy'])}; US states {FIRST_YEAR}–{last_state}"
    )


def main() -> int:
    loaders = {"hdi": hdi, "income": income, "poverty": poverty, "food": food, "democracy": democracy}
    digits = {"income": 0, "poverty": 1, "food": 1}
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
                values[iso] = [round(series[y], digits.get(key, 3)) if y in series else None for y in years]
        out["indicators"][key] = {**SOURCES[key], "lastYear": last, "values": values}
        if key == "hdi":
            states = brazil_hdi_by_state()
            last_state = max(y for s in states.values() for y in s)
            out["indicators"][key]["lastYear"] = max(last, last_state)
            out["indicators"][key]["regions"] = {
                code: [
                    round(s[y], 3) if y in s else None for y in range(FIRST_YEAR, max(last, last_state) + 1)
                ]
                for code, s in sorted(states.items())
            }
            out["indicators"][key]["regionSource"] = (
                "IDHM do Atlas do Desenvolvimento Humano no Brasil (PNUD, Ipea, FJP), via Ipeadata: "
                "metodologia própria, próxima mas não idêntica à do IDH dos países"
            )
        if key == "poverty":
            add_poverty_extras(out["indicators"][key], data)
        if key == "food":
            add_food_extras(out["indicators"][key])
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
