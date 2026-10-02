"""Results by state/province from the "results by state" tables of election articles.

    uv run python -m pipeline.americas.regions [ISO ...]   # coverage report

For each election, finds the table whose first column lists the country's
subdivisions, reads one vote column per candidate and keeps, per subdivision,
the winner and runner-up with their shares. Subdivision names are matched to
Natural Earth admin-1 regions (names, alternate and local names, plus the
aliases in data/americas/regions.yaml).

Two-round elections use the runoff table when there is one: a presidential
table (no seat columns) listing the national winner, preferring the one with
exactly two candidates.
"""

from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field

import yaml

from ..build import DATA
from ..sources.http import get_json
from ..sources.wikipedia import _TableParser, clean, parse_number, to_grid
from .discover import API, CACHE, fetch
from .geo import CODE_FIXES

NE_SOURCE = DATA / "raw" / "americas" / "geo" / "ne_10m_admin_1_states_provinces.geojson"
ALIASES = DATA / "americas" / "regions.yaml"
# A table is a "by region" table when its first column names at least this share of regions.
MIN_REGION_SHARE = 0.6
# Columns that are not candidates.
NOT_CANDIDATE = re.compile(
    r"blank|invalid|null|spoil|turnout|total|margin|registered|electors|abstention|valid|"
    r"write-?in|others?\b|other candidates|swing|seats?\b|eligible|population|^ev$|electoral vote|"
    r"difference|electorate|^%$|mesas|polling station|"
    # Spanish-language tables
    r"blanco|nulo|v[aá]lido|emitido|participaci[oó]n|inscrito|electores|abstenci[oó]n|diferencia|"
    r"otros|esca[nñ]o|votantes|padr[oó]n",
    re.I,
)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    text = re.sub(
        r"\b(department|departamento|province|provincia|state|estado|region|region de|of)\b", " ", text
    )
    return re.sub(r"[^a-z]", "", text)


def region_index(iso: str, aliases: dict) -> dict[str, list[str]]:
    """Normalized name → Natural Earth region codes (an alias may cover several)."""
    global _NE
    if "_NE" not in globals():
        _NE = json.loads(NE_SOURCE.read_text(encoding="utf-8"))["features"]
    index: dict[str, list[str]] = {}
    for f in _NE:
        p = f["properties"]
        if p["adm0_a3"] != iso:
            continue
        for key in ("name", "name_alt", "name_local", "name_en", "woe_name", "gn_name"):
            for name in (p.get(key) or "").split("|"):
                if norm(name):
                    index.setdefault(norm(name), [CODE_FIXES.get(p["adm1_code"], p["iso_3166_2"])])
    for name, codes in (aliases.get(iso) or {}).items():
        index[norm(name)] = [codes] if isinstance(codes, str) else list(codes)
    return index


def api(lang: str) -> str:
    return API if lang == "en" else f"https://{lang}.wikipedia.org/w/api.php"


def cached_parse(title: str, prop: str, lang: str = "en") -> dict:
    """`action=parse` for one prop, cached on disk (one file per language, title and prop)."""
    safe = re.sub(r"[^\w-]+", "_", title)
    path = CACHE / f"{lang}_{prop}_{safe}.json"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        d = get_json(
            api(lang),
            {
                "action": "parse",
                "page": title,
                "prop": prop,
                "format": "json",
                "formatversion": 2,
                "redirects": 1,
            },
        )
        path.write_text(json.dumps(d.get("parse", {})), encoding="utf-8")
        time.sleep(0.2)
    return json.loads(path.read_text(encoding="utf-8"))


def article_html(title: str, lang: str = "en") -> str:
    parsed = cached_parse(title, "text", lang)
    if "text" not in parsed:
        raise KeyError(title)
    return parsed["text"]


def spanish_title(title: str) -> str | None:
    links = cached_parse(title, "langlinks").get("langlinks", [])
    return next((link["title"] for link in links if link["lang"] == "es"), None)


@dataclass
class RegionTable:
    candidates: list[str]  # column labels, as in the table header
    rows: dict[str, list[float]] = field(default_factory=dict)  # region code → votes per candidate
    # region code → the table's own percentage per candidate (None where it has none)
    percents: dict[str, list[float | None]] = field(default_factory=dict)
    unmatched: list[str] = field(default_factory=list)
    has_seats: bool = False
    source: str = ""


def parse_votes(text: str) -> float | None:
    """A vote count in either convention: "1,234,567" (English) or "1.234.567" (Spanish)."""
    text = clean(text).replace("\u00a0", "").replace(" ", "")
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
        text = text.replace(".", "")
    return parse_number(text)


def parse_percent(text: str) -> float | None:
    """A percentage in either convention: "46.07%" or "46,07 %"."""
    text = clean(text).replace("%", "").strip()
    if re.fullmatch(r"\d+,\d+", text):
        text = text.replace(",", ".")
    return parse_number(text)


def read_table(grid, index: dict[str, list[str]]) -> RegionTable | None:
    first = [clean(r[0].text) if r and r[0] else "" for r in grid]
    data_start = next((i for i, name in enumerate(first) if norm(name) and norm(name) in index), None)
    if data_start is None or data_start == 0:
        return None
    header = grid[:data_start]
    width = max(len(r) for r in grid)

    def column_text(j: int, row: int) -> str:
        r = header[row]
        return clean(r[j].text) if j < len(r) and r[j] else ""

    # One vote column per candidate: the first column under each top-level label that is
    # a "Votes" column (or the only column when there are no sub-labels).
    candidates, columns, percent_columns = [], [], []
    has_seats = False
    for j in range(1, width):
        top = column_text(j, 0)
        sub = column_text(j, len(header) - 1) if len(header) > 1 else ""
        if re.search(r"\bseats?\b", f"{top} {sub}", re.I):
            has_seats = True
        if not top or NOT_CANDIDATE.search(top) or norm(top) in index:
            continue
        if sub and sub != top and not re.search(r"votes?|votos|#|^n\.?$", sub, re.I):
            continue
        if top in candidates:
            continue
        candidates.append(top)
        columns.append(j)
        # The "%" column next to the votes, under the same candidate label.
        pct = j + 1 if column_text(j + 1, 0) == top and "%" in column_text(j + 1, len(header) - 1) else None
        percent_columns.append(pct)
    if len(candidates) < 2:
        return None

    table = RegionTable(candidates, has_seats=has_seats)
    shared: list[tuple[list[str], list[float], list[float | None]]] = []
    for r in grid[data_start:]:
        if not r or not r[0]:
            continue
        name = clean(r[0].text)
        codes = index.get(norm(name))
        values = [parse_votes(r[j].text) if j < len(r) and r[j] else None for j in columns]
        if not any(v for v in values):
            continue
        if not codes:
            if not re.search(r"total|abroad|exterior|overseas|national|nationwide", name, re.I):
                table.unmatched.append(name)
            continue
        votes = [v or 0 for v in values]
        percents = [
            parse_percent(r[k].text) if k is not None and k < len(r) and r[k] else None
            for k in percent_columns
        ]
        if len(codes) == 1:
            table.rows[codes[0]] = votes
            table.percents[codes[0]] = percents
        else:  # an old region covering newer ones (Biobío before Ñuble split off)
            shared.append((codes, votes, percents))
    # A region's own row wins over a row it was once part of.
    for codes, votes, percents in shared:
        for code in codes:
            if code not in table.rows:
                table.rows[code] = votes
                table.percents[code] = percents
    return table


def tables(title: str, index: dict[str, list[str]], lang: str = "en") -> list[RegionTable]:
    parser = _TableParser()
    parser.feed(article_html(title, lang))
    out = []
    for t in parser.tables:
        rt = read_table(to_grid(t), index)
        if rt and rt.rows:
            out.append(rt)
    return out


CANADA = {"BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"}


def canada_table(title: str) -> RegionTable | None:
    """Canada's "results by province" table is transposed: provinces are columns and each
    party has a "Seats:" and a "Vote:" (percent) row. The winner of a province is the
    party with the most votes there."""
    parser = _TableParser()
    parser.feed(article_html(title))
    for t in parser.tables:
        grid = to_grid(t)
        if not grid:
            continue
        header = [clean(c.text) if c else "" for c in grid[0]]
        columns = {j: h for j, h in enumerate(header) if h in CANADA}
        if len(columns) < 10:
            continue
        parties, rows = [], {}
        for r in grid[1:]:
            cells = [clean(c.text) if c else "" for c in r]
            if len(cells) < 3 or not re.match(r"(popular )?vote", cells[2], re.I):
                continue
            party = cells[1]
            if party in parties or re.search(r"total|other|independent", party, re.I):
                continue
            parties.append(party)
            for j, abbr in columns.items():
                v = parse_percent(cells[j]) if j < len(cells) else None
                rows.setdefault(f"CA-{abbr}", []).append(v or 0)
        if len(parties) >= 2:
            table = RegionTable(parties, rows, source=f"en:{title}")
            table.percents = {code: list(v) for code, v in rows.items()}
            return table
    return None


def related_articles(title: str, lang: str = "en") -> list[str]:
    """The article itself plus linked sub-articles that may hold the results by region
    ("2012 Mexican presidential election", "Results of the … election", "Anexo:Resultados …")."""
    year = re.search(r"\d{4}", title).group(0)
    text = fetch(title)[1] if lang == "en" else cached_parse(title, "wikitext", lang).get("wikitext", "")
    links = re.findall(r"\[\[([^|\]#]+)", text) + re.findall(
        r"\{\{\s*(?:Main|See also|Further|AP|VT|Art[ií]culo principal)\s*\|([^}|]+)", text, re.I
    )
    related = [
        t.strip()
        for t in links
        if year in t
        and ":" not in t.split("Anexo:")[-1]
        and re.search(r"presidential election|results|resultados|anexo|elecci[oó]n presidencial", t, re.I)
        and not re.search(
            r"primar|opinion poll|polling|legislative|parliamentary|senate|gubernatorial|"
            r"municipal|regional|local|caucus|debate|campaign|endorsement",
            t,
            re.I,
        )
    ]
    return [title, *dict.fromkeys(t for t in related if t != title)][:6]


def surname_tokens(name: str) -> set[str]:
    return {norm(w) for w in re.split(r"[\s/()-]+", name) if len(norm(w)) >= 4}


# Votes cast abroad are not in the regions; they can decide a close race (Peru 2026).
CLOSE_RACE = 0.02


def consistent(table: RegionTable, winner: str) -> bool:
    """Sanity check: summed over regions, the national winner must come first, or within
    2% of the first. A misread table (a polling-station count read as a candidate,
    shifted columns, a missing capital) fails it."""
    want = surname_tokens(winner)
    totals = [sum(row[k] for row in table.rows.values()) for k in range(len(table.candidates))]
    mine = [t for c, t in zip(table.candidates, totals, strict=True) if want & surname_tokens(c)]
    return bool(mine) and max(mine) >= (1 - CLOSE_RACE) * max(totals)


def pick_table(found: list[RegionTable], winner: str, n_regions: int) -> RegionTable | None:
    """The presidential table with the winner, covering most regions, runoff first."""
    want = surname_tokens(winner)
    usable = [
        t
        for t in found
        if not t.has_seats
        and len(t.rows) >= MIN_REGION_SHARE * n_regions
        and any(want & surname_tokens(c) for c in t.candidates)
        and consistent(t, winner)
    ]
    if not usable:
        return None
    runoff = [t for t in usable if len(t.candidates) == 2]
    return max(runoff or usable, key=lambda t: len(t.rows))


def find_table(e: dict, index: dict[str, list[str]], n_regions: int) -> RegionTable | None:
    """English Wikipedia first, then the Spanish article and its annexes."""
    for lang, start in (("en", e["article"]), ("es", None)):
        if lang == "es":
            start = spanish_title(e["article"])
            if not start:
                break
        found = []
        for title in related_articles(start, lang):
            try:
                found += tables(title, index, lang)
            except KeyError:
                continue
        t = pick_table(found, e["winner"], n_regions)
        if t:
            t.source = f"{lang}:{start}"
            return t
    return None


def report(isos: list[str]) -> None:
    elections = yaml.safe_load((DATA / "americas" / "elections.yaml").read_text(encoding="utf-8"))
    aliases = yaml.safe_load(ALIASES.read_text(encoding="utf-8")) if ALIASES.exists() else {}
    for iso in isos or elections:
        index = region_index(iso, aliases)
        n_regions = len({c for codes in index.values() for c in codes})
        for e in elections[iso]:
            if e.get("status") == "annulled":
                continue
            t = find_table(e, index, n_regions)
            if not t:
                print(f"{iso} {e['date'][:4]}: no region table")
                continue
            all_codes = {c for codes in index.values() for c in codes}
            missing = sorted(all_codes - set(t.rows))
            print(
                f"{iso} {e['date'][:4]}: {len(t.rows)}/{n_regions} regions [{t.source[:3]}], "
                f"{t.candidates[:3]}"
                + (f", missing {missing}" if missing else "")
                + (f", unmatched {t.unmatched}" if t.unmatched else "")
            )


if __name__ == "__main__":
    report(sys.argv[1:])
