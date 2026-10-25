"""Writes motion/data/cota.json: the Chamber allowance (CEAP) race, month by month.

    uv run python motion/scripts/cota.py

Reads the yearly files pipeline.mandate caches in data/raw/camara/ (cota-<year>.csv.zip),
with the same filter: the 57th legislature, rows with a deputy id. For every month from
February 2023 to the last complete one, the cumulative net amount (vlrLiquido) of each
deputy; only those who are in the top TOP at some month are kept, with their whole series.
Only the deputy's id, name, party, state, month and amount are read.
"""

from __future__ import annotations

import csv
import io
import json
import statistics
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "camara"
OUT = ROOT / "motion" / "data" / "cota.json"
LEGISLATURE = "57"
FIRST = (2023, 2)
TOP = 15
# Amounts keep arriving for months after: a month counts as complete once its total
# reaches this share of the median month.
COMPLETE = 0.85
SMALL = {"da", "de", "do", "das", "dos", "e"}


def title(name: str) -> str:
    words = name.strip().lower().split()
    return " ".join(w if i and w in SMALL else w[:1].upper() + w[1:] for i, w in enumerate(words))


def main() -> None:
    spent: dict[str, dict[tuple[int, int], float]] = defaultdict(lambda: defaultdict(float))
    who: dict[str, tuple[tuple[int, int], str, str, str]] = {}
    for path in sorted(RAW.glob("cota-*.csv.zip")):
        with zipfile.ZipFile(path) as z:
            member = z.namelist()[0]
            with z.open(member) as raw:
                for r in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"), delimiter=";"):
                    dep = r["ideCadastro"].strip()
                    if not dep or r["codLegislatura"] != LEGISLATURE:
                        continue
                    try:
                        value = float(r["vlrLiquido"].replace(",", "."))
                        month = (int(r["numAno"]), int(r["numMes"]))
                    except ValueError:
                        continue
                    if month < FIRST:
                        continue
                    spent[dep][month] += value
                    if dep not in who or month >= who[dep][0]:
                        who[dep] = (month, r["txNomeParlamentar"], r["sgPartido"], r["sgUF"])

    totals: dict[tuple[int, int], float] = defaultdict(float)
    for months in spent.values():
        for m, v in months.items():
            totals[m] += v
    median = statistics.median(totals.values())
    last = max(m for m, v in totals.items() if v >= COMPLETE * median)
    months: list[tuple[int, int]] = []
    y, mo = FIRST
    while (y, mo) <= last:
        months.append((y, mo))
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)

    cumulative: dict[str, list[float]] = {}
    for dep, by_month in spent.items():
        run, series = 0.0, []
        for m in months:
            run += by_month.get(m, 0.0)
            series.append(round(run))
        cumulative[dep] = series
    keep: set[str] = set()
    for i in range(len(months)):
        ranked = sorted(cumulative, key=lambda d: -cumulative[d][i])
        keep.update(ranked[:TOP])

    out = {
        "months": [f"{y}-{m:02d}" for y, m in months],
        "deputies": [
            {
                "id": dep,
                "name": title(who[dep][1]),
                "party": who[dep][2],
                "uf": who[dep][3],
                "cumulative": cumulative[dep],
            }
            for dep in sorted(keep, key=lambda d: -cumulative[d][-1])
        ],
        "deputiesWithSpending": len(spent),
        "medianTotal": round(statistics.median(s[-1] for s in cumulative.values())),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT}: {len(months)} months ({out['months'][0]} → {out['months'][-1]}), {len(keep)} deputies")


if __name__ == "__main__":
    main()
