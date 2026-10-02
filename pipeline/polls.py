"""Poll records, loading and validation."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

OTHERS = "others"
UNDECIDED = "undecided"
SPECIAL_SERIES = (OTHERS, UNDECIDED)

# Published values are rounded, so each one can be up to half a point high.
ROUNDING_SLACK = 0.5


class DataError(ValueError):
    """Raised when a source file breaks the data rules."""


@dataclass(frozen=True)
class Poll:
    pollster: str
    end_date: date
    sample_size: int | None
    values: dict[str, float] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, date]:
        return self.pollster, self.end_date


def day_of_year(d: date, year: int) -> int:
    """Days since January 1st, the x coordinate used by the page."""
    return (d - date(year, 1, 1)).days


def parse_number(text: str) -> float | None:
    text = text.strip()
    return float(text) if text else None


def read_csv(path: Path) -> tuple[list[str], list[Poll]]:
    """Reads a wide poll table: pollster, date, sample_size, then one column per series."""
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fixed = ["pollster", "date", "sample_size"]
        if reader.fieldnames is None or reader.fieldnames[:3] != fixed:
            raise DataError(f"{path.name}: header must start with {', '.join(fixed)}")
        series = reader.fieldnames[3:]
        polls = []
        for line, row in enumerate(reader, start=2):
            try:
                values = {s: v for s in series if (v := parse_number(row[s])) is not None}
                n = parse_number(row["sample_size"])
                polls.append(
                    Poll(
                        row["pollster"].strip(),
                        date.fromisoformat(row["date"]),
                        int(n) if n else None,
                        values,
                    )
                )
            except ValueError as e:
                raise DataError(f"{path.name}:{line}: {e}") from e
    return series, polls


def validate(polls: list[Poll], source: str, start: date, end: date) -> None:
    """Fails on anything that would silently distort the averages."""
    seen: set[tuple[str, date]] = set()
    for p in polls:
        where = f"{source}: {p.pollster} {p.end_date}"
        if not start <= p.end_date <= end:
            raise DataError(f"{where}: fieldwork ends outside {start} – {end}")
        if p.key in seen:
            raise DataError(f"{where}: duplicate poll (same pollster and date)")
        seen.add(p.key)
        if not p.values:
            raise DataError(f"{where}: no values")
        if any(v < 0 or v > 100 for v in p.values.values()):
            raise DataError(f"{where}: value outside 0–100")
        if sum(p.values.values()) > 100 + ROUNDING_SLACK * len(p.values):
            raise DataError(f"{where}: values add up to {sum(p.values.values()):.1f}%")


def poll_record(p: Poll, year: int, series: list[str]) -> dict:
    """Compact JSON shape: p = pollster, d = day of year, n = sample size, v = values."""
    rec: dict = {"p": p.pollster, "d": day_of_year(p.end_date, year)}
    if p.sample_size:
        rec["n"] = p.sample_size
    rec["v"] = {s: p.values[s] for s in series if s in p.values}
    return rec
