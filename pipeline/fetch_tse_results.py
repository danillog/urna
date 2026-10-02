"""Downloads official presidential results per municipality from TSE open data.

Groundwork for the municipality map. Uses only the standard library.

    uv run python -m pipeline.fetch_tse_results          # 2010, 2014, 2018 and 2022
    uv run python -m pipeline.fetch_tse_results 2022     # a single year
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
DEFAULT_YEARS = ["2010", "2014", "2018", "2022"]
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "tse" / "president_by_municipality.csv"
CHUNK_SIZE = 1 << 20

# (year, round, state, TSE municipality code, municipality, ballot number, candidate, party)
Key = tuple[str, str, str, str, str, str, str, str]


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
    """Prefers the national file when the archive also ships one file per state."""
    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    national = [n for n in names if n.upper().endswith("_BR.CSV")]
    return national or names


def aggregate(year: str, archive: Path, votes: dict[Key, int]) -> int:
    """Sums presidential votes over electoral zones, per municipality and candidate."""
    rows = 0
    with zipfile.ZipFile(archive) as zf:
        for name in csv_members(zf):
            with zf.open(name) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";")
                for row in reader:
                    if row.get("DS_CARGO", "").strip().upper() != "PRESIDENTE":
                        continue
                    key = (
                        year,
                        row["NR_TURNO"],
                        row["SG_UF"],
                        row["CD_MUNICIPIO"],
                        row["NM_MUNICIPIO"],
                        row["NR_CANDIDATO"],
                        row["NM_URNA_CANDIDATO"],
                        row["SG_PARTIDO"],
                    )
                    votes[key] += int(row["QT_VOTOS_NOMINAIS"] or 0)
                    rows += 1
    return rows


def main() -> None:
    years = sys.argv[1:] or DEFAULT_YEARS
    votes: dict[Key, int] = defaultdict(int)
    with tempfile.TemporaryDirectory() as tmp:
        for year in years:
            archive = Path(tmp) / f"{year}.zip"
            print(f"Downloading {year}...")
            download(year, archive)
            print(f"  {year}: {aggregate(year, archive, votes):,} presidential rows read")
            archive.unlink()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "year",
                "round",
                "state",
                "tse_municipality_code",
                "municipality",
                "ballot_number",
                "candidate",
                "party",
                "votes",
            ]
        )
        for key in sorted(votes):
            w.writerow([*key, votes[key]])
    print(f"Done: {OUTPUT} ({OUTPUT.stat().st_size / 1e6:.1f} MB, {len(votes):,} rows)")


if __name__ == "__main__":
    main()
