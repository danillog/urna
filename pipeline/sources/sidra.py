"""IBGE aggregates API (SIDRA): census tables by municipality.

    values(10061, 2022, 2667, {1568: "all", 58: [95253]})

returns municipality code → (category ids, in the order of the classifications given)
→ value. Classifications left out are taken at their total. Requests go one state at a
time, to keep responses small, and are cached in data/raw/sidra/.
"""

from __future__ import annotations

import json
import time
import urllib.error
from pathlib import Path

from .http import get
from .ipea import UF_BY_CODE

URL = "https://servicodados.ibge.gov.br/api/v3/agregados/{table}/periodos/{period}/variaveis/{variable}"
CACHE = Path(__file__).resolve().parents[2] / "data" / "raw" / "sidra"

Categories = dict[int, list[int] | str]


def _query(classifications: Categories) -> str:
    return "|".join(
        f"{cls}[{cats if isinstance(cats, str) else ','.join(map(str, cats))}]"
        for cls, cats in classifications.items()
    )


def _fetch(table: int, period: int, variable: int, classifications: Categories, uf: str) -> list:
    query = _query(classifications)
    path = CACHE / f"{table}-{period}-{variable}-{query.replace('|', '_')}-{uf}.json"
    if not path.exists():
        url = URL.format(table=table, period=period, variable=variable)
        for attempt in range(4):
            try:
                body = get(f"{url}?localidades=N6[N3[{uf}]]&classificacao={query}")
                break
            except (urllib.error.URLError, TimeoutError):
                # The service fails now and then under load; it is fine on a retry.
                if attempt == 3:
                    raise
                time.sleep(5 * (attempt + 1))
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    return json.loads(path.read_text(encoding="utf-8"))


def parse(response: list, order: list[int]) -> dict[str, dict[tuple[int, ...], float]]:
    """Municipality → categories → value. Suppressed or empty cells ("-", "X", "...") are left out."""
    out: dict[str, dict[tuple[int, ...], float]] = {}
    for result in response[0]["resultados"] if response else []:
        by_id = {int(c["id"]): int(next(iter(c["categoria"]))) for c in result["classificacoes"]}
        key = tuple(by_id[cls] for cls in order)
        for s in result["series"]:
            raw = next(iter(s["serie"].values()))
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            out.setdefault(s["localidade"]["id"], {})[key] = value
    return out


def values(
    table: int, period: int, variable: int, classifications: Categories
) -> dict[str, dict[tuple[int, ...], float]]:
    out: dict[str, dict[tuple[int, ...], float]] = {}
    for uf in UF_BY_CODE:
        out.update(parse(_fetch(table, period, variable, classifications, uf), list(classifications)))
    return out
