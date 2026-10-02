"""Downloads official results per municipality from TSE open data.

President (1994 onwards) and mayor (1996 onwards), one CSV per election year
in data/raw/tse/, summed over electoral zones. Uses only the standard library.

    uv run python -m pipeline.fetch_tse_results            # every year not downloaded yet
    uv run python -m pipeline.fetch_tse_results 2022 2024  # specific years (re-downloads)
"""

from __future__ import annotations

import csv
import io
import sys
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_{year}.zip"
PRESIDENTIAL_YEARS = [str(y) for y in range(1994, 2023, 4)]
MUNICIPAL_YEARS = [str(y) for y in range(1996, 2025, 4)]
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "tse"
OFFICES = {"PRESIDENTE": "president", "PREFEITO": "mayor"}
CHUNK_SIZE = 1 << 20

# (round, state, TSE municipality code, municipality, office, candidate, party, outcome)
Key = tuple[str, str, str, str, str, str, str, str]
HEADER = [
    "year",
    "round",
    "state",
    "tse_municipality_code",
    "municipality",
    "office",
    "candidate",
    "party",
    "outcome",
    "votes",
]


def output_path(year: str) -> Path:
    return OUTPUT_DIR / f"results_{year}.csv"


def download(year: str, target: Path) -> None:
    with urllib.request.urlopen(URL.format(year=year), timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        with target.open("wb") as f:
            while chunk := resp.read(CHUNK_SIZE):
                f.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {year}: {done / total:6.1%} of {total / 1e6:,.0f} MB", end="", flush=True)
    print()


def csv_members(zf: zipfile.ZipFile) -> list[str]:
    """The national file when the archive ships one ("_BR.csv" or "_BRASIL.csv",
    depending on the year); reading it next to the state files would count
    every vote twice."""
    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    national = [n for n in names if n.upper().endswith(("_BR.CSV", "_BRASIL.CSV"))]
    return national[:1] or names


def votes_of(row: dict[str, str]) -> int:
    """Valid votes when the file has them (votes for annulled candidacies are not valid)."""
    valid = row.get("QT_VOTOS_NOMINAIS_VALIDOS", "").strip()
    if valid and int(valid) >= 0:
        return int(valid)
    return int(row["QT_VOTOS_NOMINAIS"] or 0)


def aggregate(archive: Path, votes: dict[Key, int]) -> int:
    """Sums votes for president and mayor over electoral zones."""
    rows = 0
    with zipfile.ZipFile(archive) as zf:
        for name in csv_members(zf):
            with zf.open(name) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";")
                for row in reader:
                    office = OFFICES.get(row.get("DS_CARGO", "").strip().upper())
                    if not office:
                        continue
                    key = (
                        row["NR_TURNO"],
                        row["SG_UF"],
                        str(int(row["CD_MUNICIPIO"])),
                        row["NM_MUNICIPIO"].strip(),
                        office,
                        " ".join(row["NM_URNA_CANDIDATO"].split()),
                        row["SG_PARTIDO"].strip(),
                        row.get("DS_SIT_TOT_TURNO", "").strip(),
                    )
                    votes[key] += votes_of(row)
                    rows += 1
    return rows


def fetch_year(year: str) -> None:
    votes: dict[Key, int] = defaultdict(int)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / f"{year}.zip"
        print(f"Downloading {year}...")
        download(year, archive)
        print(f"  {year}: {aggregate(archive, votes):,} rows for president or mayor")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = output_path(year)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(HEADER)
        for key in sorted(votes):
            w.writerow([year, *key, votes[key]])
    print(f"  wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB, {len(votes):,} rows)")


def main() -> None:
    requested = sys.argv[1:]
    years = requested or sorted(PRESIDENTIAL_YEARS + MUNICIPAL_YEARS)
    for year in years:
        if not requested and output_path(year).exists():
            print(f"{year}: already downloaded")
            continue
        fetch_year(year)


if __name__ == "__main__":
    main()
