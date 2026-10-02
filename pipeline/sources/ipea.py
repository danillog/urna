"""Ipeadata open API (OData v4): series values by territory.

Used for the Atlas of Human Development in Brazil (PNUD, Ipea, FJP):
- IDHM: state HDI, census years and yearly since 2012 (PNAD Contínua);
- ADH_IDHM: municipal HDI in the 1991, 2000 and 2010 censuses.
"""

from __future__ import annotations

import json
from pathlib import Path

from .http import get

URL = "http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='{code}')"
CACHE = Path(__file__).resolve().parents[2] / "data" / "raw" / "ipea"

# IBGE state codes → state abbreviations.
UF_BY_CODE = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE",
    "29": "BA",
    "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
    "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}  # fmt: skip


def series(code: str) -> list[dict]:
    path = CACHE / f"{code}.json"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(URL.format(code=code)))
    return json.loads(path.read_text(encoding="utf-8"))["value"]


def by_territory(code: str, level: str) -> dict[str, dict[int, float]]:
    """Territory code → year → value, for one level ("Estados", "Municípios")."""
    out: dict[str, dict[int, float]] = {}
    for row in series(code):
        if row["NIVNOME"] == level and row["VALVALOR"] is not None:
            out.setdefault(row["TERCODIGO"], {})[int(row["VALDATA"][:4])] = float(row["VALVALOR"])
    return out
