"""Where an election's files live on the TSE's results site (resultados.tse.jus.br).

The site numbers every election: in 2026, the 1st round is pleito 3220 with the federal
election (president, deputies, senators… counted nationally) 6257 and the state election
(governor, senator, deputies) 6259. The runoff gets new numbers, published in the site's
configuration (comum/config/ele-c.json) only shortly before the day. Scripts ask here
instead of writing them down, so the runoff needs no code change.
"""

from __future__ import annotations

import json
import re
from functools import cache

from .http import get

SITE = "https://resultados.tse.jus.br/oficial"
CONFIG = f"{SITE}/comum/config/ele-c.json"
KINDS = {"Federal": "federal", "Estadual": "state", "Municipal": "municipal"}


class NotPublished(LookupError):
    """The TSE has not listed that round yet."""


def parse_config(raw: dict, year: int) -> dict[str, dict[str, str]]:
    """{"r1": {"pleito": "3220", "date": "04/10/2026", "federal": "6257", "state": "6259"}, ...}

    Regular elections only ("Eleição Ordinária"): supplementary ones and referendums share
    the list."""
    out: dict[str, dict[str, str]] = {}
    for pleito in raw.get("pl", []):
        if not str(pleito.get("dt", "")).endswith(str(year)):
            continue
        for e in pleito.get("e", []):
            m = re.match(r"Eleição Ordinária (Federal|Estadual|Municipal)\b", str(e.get("nm", "")))
            if not m:
                continue
            round_id = f"r{e['t']}"
            entry = out.setdefault(round_id, {"pleito": str(pleito["cd"]), "date": str(pleito["dt"])})
            entry[KINDS[m[1]]] = str(e["cd"])
    return out


@cache
def config(year: int) -> dict[str, dict[str, str]]:
    return parse_config(json.loads(get(CONFIG)), year)


def election(year: int, round_id: str, kind: str) -> str:
    """The election number, e.g. election(2026, "r1", "federal") → "6257"."""
    try:
        return config(year)[round_id][kind]
    except KeyError:
        raise NotPublished(
            f"the TSE has not published the {kind} election of {year} {round_id} yet (see {CONFIG})"
        ) from None


def pleito(year: int, round_id: str) -> str:
    try:
        return config(year)[round_id]["pleito"]
    except KeyError:
        raise NotPublished(f"the TSE has not published {year} {round_id} yet (see {CONFIG})") from None


def base(year: int) -> str:
    return f"{SITE}/ele{year}"


def file_url(year: int, election_: str, office: int, place: str, uf: str | None = None) -> str:
    """One count file: `place` is "br", a state ("sp") or a TSE municipality code with `uf`."""
    folder = uf or place
    name = f"{uf}{place}" if uf else place
    return f"{base(year)}/{election_}/dados/{folder}/{name}-c{office:04d}-e{election_.zfill(6)}-u.json"
