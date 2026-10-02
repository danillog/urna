"""The TSE registry of election polls (dados abertos, "Pesquisas Eleitorais").

Every poll must be registered with the TSE before it is published, so the
registry lists who polled, when, for which office and with what sample. It
does not hold the results. The crawler uses it as a checklist of polls that
should be in the dataset.
"""

from __future__ import annotations

import csv
import io
import re
import time
import unicodedata
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .http import get

URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/pesquisa_eleitoral/pesquisa_eleitoral_{year}.zip"
# The TSE regenerates the file daily; reuse a download younger than this.
CACHE_SECONDS = 6 * 3600

OFFICES = {"Presidente": "president", "Governador": "governor", "Senador": "senate"}

# Phrases that describe a national sample. Generic words are not enough:
# state samples also cite the "Instituto Brasileiro de Geografia" or the
# "população brasileira" of the census.
NATIONAL = re.compile(
    r"eleitorado (brasileiro|de brasil|do brasil|nacional)"
    r"|abrangencia[^.]{0,40}\b(nacional|brasil)\b"
    r"|territorio nacional"
    r"|regioes (geograficas )?do brasil"
    r"|cinco (grandes )?regioes"
    r"|universo: populacao brasileira"
)


@dataclass(frozen=True)
class Registration:
    protocol: str
    pollster: str
    offices: frozenset[str]
    # "BR" for a national sample, a state code for a state sample, None if unclear.
    scope: str | None
    start: date
    end: date
    release: date
    sample_size: int | None


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def classify_scope(row: dict[str, str], state_names: dict[str, str]) -> str | None:
    """National or state sample. Presidential polls are all filed under "BR", so
    the sample description is the only place that says which one it is."""
    if row["SG_UF"] != "BR":
        return row["SG_UF"]
    text = _ascii(f"{row['DS_PLANO_AMOSTRAL']} {row['DS_DADO_MUNICIPIO']}")
    for uf, name in state_names.items():
        if re.search(
            rf"\b(estado|territorio|unidade da federacao)\s+(d[eoa]s?\s+)?{re.escape(_ascii(name))}\b", text
        ):
            return uf
    if NATIONAL.search(text):
        return "BR"
    return None


def _date(text: str) -> date:
    return date.fromisoformat(text[:10])


def download(year: int, cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"pesquisa_eleitoral_{year}.zip"
    if not path.exists() or time.time() - path.stat().st_mtime > CACHE_SECONDS:
        path.write_bytes(get(URL.format(year=year)))
    return path


def read_registrations(archive: Path, state_names: dict[str, str]) -> list[Registration]:
    out = []
    with zipfile.ZipFile(archive) as zf:
        name = next(n for n in zf.namelist() if n.upper().endswith("_BRASIL.CSV"))
        with zf.open(name) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";"):
                offices = frozenset(
                    OFFICES[o.strip()] for o in row["DS_CARGO"].split(",") if o.strip() in OFFICES
                )
                if not offices:
                    continue
                pollster = row["NM_EMPRESA_FANTASIA"].strip()
                if not pollster or pollster == "#NULO#":
                    pollster = row["NM_EMPRESA"].strip()
                sample = row["QT_ENTREVISTADO"].strip()
                out.append(
                    Registration(
                        protocol=row["NR_PROTOCOLO_REGISTRO"],
                        pollster=pollster,
                        offices=offices,
                        scope=classify_scope(row, state_names),
                        start=_date(row["DT_INICIO_PESQUISA"]),
                        end=_date(row["DT_FIM_PESQUISA"]),
                        release=_date(row["DT_DIVULGACAO"]),
                        sample_size=int(sample) if sample.isdigit() else None,
                    )
                )
    return out
