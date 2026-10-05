"""Reads the poll tables of a Wikipedia "Opinion polling for ..." page.

The tables share one layout: a three-row header (pollster, polling period,
one column per candidate, others, blank/null/undecided, margin of error,
sample size, lead, link), then one row per scenario. A poll with several
scenarios spans several rows, its pollster and period cells merged with
rowspan. Rows spanning the whole table are campaign events and are skipped.

The Portuguese state pages ("Pesquisas eleitorais para a eleição estadual de
2026 em ...") use the same layout with Portuguese headers, dates written as
"28 a 30 de setembro" or "28 – 30 Set", and decimal commas ("57,3%", "1 600").
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser

from .http import get_json

API = "https://{lang}.wikipedia.org/w/api.php"
# English and Portuguese month abbreviations; none of them clash.
EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
PT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
MONTHS = {m: i for months in (EN_MONTHS, PT_MONTHS) for i, m in enumerate(months, start=1)}
# "28–30 Sep", "30 Sep–2 Oct", "28 a 30 de setembro", "4 a 7 de dezembro de 2025":
# fieldwork ends on the last day/month pair, in the year written after it if any.
DAY_MONTH = re.compile(r"(\d{1,2})\s*(?:de\s+)?([A-Za-zç]{3})[a-zç]*\.?(?:\s+(?:de\s+)?(\d{4}))?")
# Header words, English and Portuguese, of the columns that are not candidates.
META_COLUMNS = {
    "pollster": ("pollster", "contratante", "instituto"),
    "period": ("period", "data"),
    "sample": ("sample", "amostra"),
    "margin": ("margin", "margem"),
    "lead": ("lead", "vantagem"),
    "link": ("link",),
    "scenario": ("cen.",),
}
HEADING = re.compile(r"<h2[^>]*>(.*?)</h2>", re.S)
SUBHEADING = re.compile(r"<h([3-6])[^>]*>(.*?)</h\1>", re.S)
YEAR = re.compile(r"\b(20\d\d)\b")


@dataclass
class Cell:
    text: str = ""
    rowspan: int = 1
    colspan: int = 1


@dataclass
class Scenario:
    """One row of a poll: candidate (or others/undecided) header → value."""

    values: dict[str, float]


@dataclass
class WikiPoll:
    pollster: str
    period: str
    end_date: date
    sample_size: int | None
    scenarios: list[Scenario] = field(default_factory=list)
    # The merged period cell; scenario rows of the same poll share it.
    period_cell: Cell | None = field(default=None, repr=False, compare=False)


class _TableParser(HTMLParser):
    """Collects every table as rows of cells; footnotes and styles are dropped."""

    SKIPPED = {"sup", "style", "script"}

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[Cell]]] = []
        self._row: list[Cell] | None = None
        self._cell: Cell | None = None
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self.SKIPPED:
            self._skip += 1
        elif tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self._row = []
            self.tables[-1].append(self._row)
        elif tag in ("td", "th") and self._row is not None:
            self._cell = Cell(rowspan=_span(a.get("rowspan")), colspan=_span(a.get("colspan")))
            self._row.append(self._cell)
        elif tag == "br" and self._cell is not None:
            self._cell.text += " "

    def handle_endtag(self, tag):
        if tag in self.SKIPPED:
            self._skip -= 1
        elif tag in ("td", "th"):
            self._cell = None

    def handle_data(self, data):
        if self._cell is not None and not self._skip:
            self._cell.text += data + " "


def _span(value: str | None) -> int:
    try:
        return max(1, int(value or 1))
    except ValueError:
        return 1


def to_grid(rows: list[list[Cell]]) -> list[list[Cell | None]]:
    """Expands rowspan/colspan so every row has one entry per column.

    Cells repeated by a rowspan are the same object, which is how scenario rows
    of one poll are recognised as belonging together.
    """
    grid: list[list[Cell | None]] = []
    pending: dict[tuple[int, int], Cell] = {}
    for r, row in enumerate(rows):
        out: list[Cell | None] = []
        cells = iter(row)
        c = 0
        while True:
            if (r, c) in pending:
                out.append(pending.pop((r, c)))
                c += 1
                continue
            cell = next(cells, None)
            if cell is None:
                break
            for dc in range(cell.colspan):
                out.append(cell)
                for dr in range(1, cell.rowspan):
                    pending[(r + dr, c + dc)] = cell
            c += cell.colspan
        # Trailing cells still owed by a rowspan from above.
        while (r, c) in pending:
            out.append(pending.pop((r, c)))
            c += 1
        grid.append(out)
    return grid


def clean(text: str) -> str:
    return " ".join(text.split())


def parse_number(text: str, decimal_comma: bool = False) -> float | None:
    """ "2,506" and "42" in English; "1 600", "1.600" and "57,3%" with decimal_comma."""
    text = clean(text).rstrip("%").strip()
    text = re.sub(r"[\s.]", "", text).replace(",", ".") if decimal_comma else text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def parse_end_date(period: str, year: int) -> date | None:
    pairs = [(d, m.lower(), y) for d, m, y in DAY_MONTH.findall(period) if m.lower() in MONTHS]
    if not pairs:
        return None
    day, month, written_year = pairs[-1]
    try:
        return date(int(written_year or year), MONTHS[month], int(day))
    except ValueError:
        return None


def parse_table(rows: list[list[Cell]], year: int, decimal_comma: bool = False) -> list[WikiPoll]:
    grid = to_grid(rows)
    if not grid or not grid[0]:
        return []
    header_rows = grid[0][0].rowspan if grid[0][0] else 1
    width = max(len(r) for r in grid)
    headers = []
    for col in range(width):
        parts = []
        for r in grid[:header_rows]:
            cell = r[col] if col < len(r) else None
            text = clean(cell.text) if cell else ""
            if text and text not in parts:
                parts.append(text)
        headers.append(" ".join(parts))

    def find(*needles: str) -> int | None:
        for i, h in enumerate(headers):
            if any(n in h.lower() for n in needles):
                return i
        return None

    cols = {name: find(*needles) for name, needles in META_COLUMNS.items()}
    pollster_col, period_col, sample_col = cols["pollster"], cols["period"], cols["sample"]
    if pollster_col is None or period_col is None:
        return []
    meta = set(cols.values())
    value_cols = [i for i in range(width) if i not in meta and headers[i]]

    polls: list[WikiPoll] = []
    for row in grid[header_rows:]:
        if len(row) < width or row[pollster_col] is None:
            continue
        pollster_cell, period_cell = row[pollster_col], row[period_col]
        # Event rows span the table: pollster and period are the same merged cell.
        if pollster_cell is period_cell or not clean(pollster_cell.text):
            continue
        values = {
            headers[i]: v for i in value_cols if (v := parse_number(row[i].text, decimal_comma)) is not None
        }
        if polls and polls[-1].period_cell is period_cell:
            polls[-1].scenarios.append(Scenario(values))
            continue
        end = parse_end_date(clean(period_cell.text), year)
        if end is None:
            continue
        sample = parse_number(row[sample_col].text, decimal_comma) if sample_col is not None else None
        polls.append(
            WikiPoll(
                clean(pollster_cell.text),
                clean(period_cell.text),
                end,
                int(sample) if sample else None,
                [Scenario(values)],
                period_cell,
            )
        )
    return polls


def sections(page: str) -> list[dict]:
    return get_json(
        API.format(lang="en"),
        {"action": "parse", "page": page, "prop": "sections", "format": "json", "formatversion": 2},
    )["parse"]["sections"]


def section_html(page: str, index: str) -> str:
    return get_json(
        API.format(lang="en"),
        {
            "action": "parse",
            "page": page,
            "prop": "text",
            "section": index,
            "format": "json",
            "formatversion": 2,
        },
    )["parse"]["text"]


def year_section(all_sections: list[dict], round_title: str, year: int) -> str | None:
    """Index of the `year` section under a "First round"-style heading.

    Fetching a section also returns its subsections (Jan–Mar, Apr–Aug...).
    """
    in_round = False
    for s in all_sections:
        title = clean(re.sub("<[^>]+>", "", s["line"]))
        if s["toclevel"] == 1:
            in_round = title.lower() == round_title.lower()
        elif s["toclevel"] == 2 and in_round and title == str(year):
            return s["index"]
    return None


def fetch_polls(page: str, round_title: str, year: int) -> list[WikiPoll]:
    index = year_section(sections(page), round_title, year)
    if index is None:
        return []
    return parse_polls(section_html(page, index), year)


def page_html(page: str, lang: str) -> str | None:
    """The whole rendered page, or None when it does not exist."""
    data = get_json(
        API.format(lang=lang),
        {
            "action": "parse",
            "page": page,
            "prop": "text",
            "redirects": 1,
            "format": "json",
            "formatversion": 2,
        },
    )
    return data["parse"]["text"] if "parse" in data else None


def split_sections(page: str) -> list[tuple[str, str]]:
    """(top-level heading, its HTML up to the next one) for a rendered page."""
    marks = list(HEADING.finditer(page))
    ends = [m.start() for m in marks[1:]] + [len(page)]
    return [(heading_text(m.group(1)), page[m.end() : end]) for m, end in zip(marks, ends, strict=True)]


def heading_text(fragment: str) -> str:
    return clean(html.unescape(re.sub("<[^>]+>", "", fragment)))


def parse_polls(section: str, year: int, decimal_comma: bool = False) -> list[WikiPoll]:
    """Polls of every table in `section`.

    Dates rarely state the year: it comes from the nearest subheading that does
    ("2025", "Setembro – Outubro de 2026"), or else `year`.
    """

    def tables(fragment: str, table_year: int) -> list[WikiPoll]:
        parser = _TableParser()
        parser.feed(fragment)
        return [p for table in parser.tables for p in parse_table(table, table_year, decimal_comma)]

    polls: list[WikiPoll] = []
    years: dict[int, int | None] = {}  # heading level → the year it names
    current, pos = year, 0
    for m in SUBHEADING.finditer(section):
        polls += tables(section[pos : m.start()], current)
        level = int(m.group(1))
        years = {lv: y for lv, y in years.items() if lv < level}
        named = YEAR.findall(heading_text(m.group(2)))
        years[level] = int(named[-1]) if named else None
        current = next((y for _, y in sorted(years.items(), reverse=True) if y), year)
        pos = m.end()
    return polls + tables(section[pos:], current)


def existing_titles(titles: list[str], lang: str) -> set[str]:
    """The titles, among `titles`, of pages that exist (directly or as a redirect)."""
    found: set[str] = set()
    for i in range(0, len(titles), 50):  # the API's limit per query
        query = get_json(
            API.format(lang=lang),
            {
                "action": "query",
                "titles": "|".join(titles[i : i + 50]),
                "redirects": 1,
                "format": "json",
                "formatversion": 2,
            },
        )["query"]
        targets = {p["title"] for p in query["pages"] if not p.get("missing")}
        aliases = {r["from"]: r["to"] for r in query.get("normalized", []) + query.get("redirects", [])}
        for title in titles[i : i + 50]:
            t = title
            while t in aliases and t not in targets:
                t = aliases[t]
            if t in targets:
                found.add(title)
    return found
