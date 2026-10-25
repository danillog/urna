"""Builds data/generated/capitals.json: the 2026 vote inside each state capital, area by area.

    uv run python -m pipeline.capitals              # every capital
    uv run python -m pipeline.capitals 2611606      # some, by IBGE code
    uv run python -m pipeline.capitals r2           # the runoff, beside the 1st round ("r2")

The runoff's election numbers come from the TSE's configuration once it lists them
(pipeline.sources.tse_results); its reports are cached apart (sections-r2/).

The unit is the IBGE's weighting area (área de ponderação): groups of neighbourhoods
for which the 2022 Census sample is published, so religion, schooling and income
exist for each (1,472 in the capitals; 332 in São Paulo, 12 in Macapá).

Inputs, downloaded once into data/raw/capitals/ (not in git):
- IBGE, census tracts with attributes (setores, 2022), per state: geometry, the
  neighbourhood name and the population of each tract.
- IBGE, which tracts make each weighting area ("Composição das Áreas de Ponderação").
- IBGE, sample results by weighting area: religion (table 4.1), schooling of people
  aged 25+ (2.2) and their mean years of study (2.3), household income per person, mean
  and median (8.3), the labour force (7.1), the way to work and its time (10.2, 10.3),
  tenure, walls and internet of the home (1.5, 1.6, 1.8), people who lived in another
  municipality (6.1). The first row of each table is Brazil's.
- IBGE, census universe by tract: colour or race, age, couples, kind of home, bathrooms,
  sewage and literacy.
- TSE, polling places of 2026 with latitude and longitude, by section.
- TSE, every section's ballot-box report (boletim de urna) of the 2026 1st round, read
  from resultados.tse.jus.br; only the president's count is kept (data/raw/capitals/
  sections/<ibge>.json), so a rerun does not download them again.

Each section is placed in the weighting area its polling place falls in. Voters vote
where they registered, which is not always where they live now: an area's vote is
the vote cast there.

Geometry: tracts are merged into areas and simplified with mapshaper (npm dev
dependency), into one TopoJSON object for all capitals.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import yaml

from . import apuracao_cidades
from .build import DATA
from .sources import tse_results
from .sources.http import get

RAW = DATA / "raw" / "capitals"
SECTIONS = RAW / "sections"
OUTPUT = DATA / "generated" / "capitals.json"
ROOT = Path(__file__).resolve().parent.parent

IBGE = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022"
TRACTS = (
    IBGE
    + "/Agregados_por_Setores_Censitarios/malha_com_atributos/setores/shp/UF/{uf}/{uf}_setores_CD2022.zip"
)
AP_DOCS = IBGE + "/Microdados_e_Areas_de_Ponderacao/Documentacao/%c3%81reas%20de%20pondera%c3%a7%c3%a3o"
COMPOSITION = AP_DOCS + "/Composi%c3%a7%c3%a3o%20das%20%c3%81reas%20de%20Pondera%c3%a7%c3%a3o.xlsx"
AP_TABLES = IBGE + "/Microdados_e_Areas_de_Ponderacao/Areas_de_Ponderacao/tabelas_xlsx.zip"
PLACES = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip"
YEAR = 2026
PRESIDENT = 1
# Ballot numbers: the PT's candidate and the strongest rival (Flávio, PL).
PT, RIVAL = 13, 22

CAPITALS = {
    "1100205": "Porto Velho", "1200401": "Rio Branco", "1302603": "Manaus", "1400100": "Boa Vista",
    "1501402": "Belém", "1600303": "Macapá", "1721000": "Palmas", "2111300": "São Luís",
    "2211001": "Teresina", "2304400": "Fortaleza", "2408102": "Natal", "2507507": "João Pessoa",
    "2611606": "Recife", "2704302": "Maceió", "2800308": "Aracaju", "2927408": "Salvador",
    "3106200": "Belo Horizonte", "3205309": "Vitória", "3304557": "Rio de Janeiro",
    "3550308": "São Paulo", "4106902": "Curitiba", "4205407": "Florianópolis",
    "4314902": "Porto Alegre", "5002704": "Campo Grande", "5103403": "Cuiabá",
    "5208707": "Goiânia", "5300108": "Brasília",
}  # fmt: skip
WORKERS = 16


def cached(name: str, url: str) -> Path:
    path = RAW / name
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {name}…", flush=True)
        path.write_bytes(get(url))
    return path


# --- Spreadsheets (xlsx is zipped XML; the standard library is enough) -------------------

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def xlsx_rows(source: Path | bytes):
    """Rows of the first sheet as {column letter: text}, streamed: some sheets are 100 MB."""
    z = zipfile.ZipFile(source if isinstance(source, Path) else io.BytesIO(source))
    strings: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS + "si"):
            strings.append("".join(t.text or "" for t in si.iter(NS + "t")))
    sheet = sorted(n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))[0]
    with z.open(sheet) as f:
        for _, el in ET.iterparse(f):
            if el.tag != NS + "row":
                continue
            row = {}
            for c in el.iter(NS + "c"):
                col = re.match(r"[A-Z]+", c.get("r", "")).group()
                v = c.find(NS + "v")
                if v is not None and v.text is not None:
                    row[col] = strings[int(v.text)] if c.get("t") == "s" else v.text
                else:
                    row[col] = "".join(t.text or "" for t in c.iter(NS + "t")) or None
            yield row
            el.clear()


def number(v: str | None) -> float:
    try:
        return float(v) if v not in (None, "-", "X", "..") else 0.0
    except ValueError:
        return 0.0


def composition(codes: set[str]) -> dict[str, str]:
    """Tract → weighting area, for the municipalities asked."""
    out = {}
    for r in xlsx_rows(cached("composicao_areas_de_ponderacao.xlsx", COMPOSITION)):
        if r.get("B") in codes:
            out[r["A"]] = r["C"]
    return out


# Shares read from the sample tables: variable → (table, columns of the part, column of the
# whole). Columns as the IBGE's sheets have them (E is each table's total).
SHARES: dict[str, tuple[str, str, str]] = {
    # Religion of people 10+ (4.1): Espírita, Umbanda e Candomblé apart; the rest below.
    "catholic": ("Tab4_1", "F", "E"),
    "evangelical": ("Tab4_1", "G", "E"),
    "spiritist": ("Tab4_1", "H", "E"),
    "afro": ("Tab4_1", "I", "E"),
    "noReligion": ("Tab4_1", "L", "E"),
    # Schooling of adults 25+ (2.2): none or primary incomplete, primary, secondary, a degree.
    "eduBasic": ("Tab2_2", "F", "E"),
    "eduFund": ("Tab2_2", "G", "E"),
    "eduMid": ("Tab2_2", "H", "E"),
    "degree": ("Tab2_2", "I", "E"),
    # People 14+ in the labour force (7.1): the unemployed (desocupados) among them.
    "unemployed": ("Tab7_1", "H", "F"),
    # Workers who go to work (10.2, 10.3): over an hour each way; how they go.
    "commuteLong": ("Tab10_2", "JKL", "E"),
    "commuteWalk": ("Tab10_3", "FG", "E"),  # on foot, by bicycle
    "commuteMoto": ("Tab10_3", "HI", "E"),  # motorcycle, motorcycle taxi
    "commuteCar": ("Tab10_3", "JK", "E"),  # car, taxi or ride app
    "commuteTransit": ("Tab10_3", "LMNO", "E"),  # van, bus, BRT, train or metro
    # People in permanent private households (1.5, 1.6, 1.8): renting; walls of bare brick
    # or clay, scrap wood, other or none (wood made for building, common in the South, is
    # not counted); no internet at home.
    "renting": ("Tab1_5", "I", "E"),
    "poorWalls": ("Tab1_6", "GHJKL", "E"),
    "noInternet": ("Tab1_8", "G", "E"),
}
# The people of each area (residents of private households), for the share who ever lived in
# another municipality (6.1 counts only those).
RESIDENTS = ("Tab1_5", "E")


def area_tables(codes: set[str]) -> tuple[dict[str, dict], dict]:
    """Weighting area → census sample figures; and the same figures for Brazil (each table's
    first row)."""
    tables = zipfile.ZipFile(cached("areas_de_ponderacao_tabelas.zip", AP_TABLES))
    out: dict[str, dict] = defaultdict(dict)

    def each(name: str):
        """(area or "BR", row) for the areas asked and Brazil."""
        for r in xlsx_rows(tables.read(f"{name}.xlsx")):
            if r.get("A") == "Brasil":
                yield "BR", r
            elif r.get("A") in codes and r.get("C"):
                yield r["C"], r

    by_table: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for key, (table, part, whole) in SHARES.items():
        by_table[table].append((key, part, whole))
    for table, keys in by_table.items():
        for area, r in each(table):
            for key, part, whole in keys:
                if total := number(r.get(whole)):
                    out[area][key] = sum(number(r.get(c)) for c in part) / total * 100
    for d in out.values():
        if all(k in d for k in ("catholic", "evangelical", "spiritist", "afro", "noReligion")):
            # Other faiths, indigenous traditions, "does not know" and undeclared.
            d["otherReligion"] = max(
                0.0, 100 - sum(d[k] for k in ("catholic", "evangelical", "spiritist", "afro", "noReligion"))
            )
    residents = {area: number(r.get(RESIDENTS[1])) for area, r in each(RESIDENTS[0])}
    for area, r in each("Tab6_1"):
        if residents.get(area):
            out[area]["migrant"] = number(r.get("E")) / residents[area] * 100
    for area, r in each("Tab2_3"):
        out[area]["schoolYears"] = number(r.get("E"))
    for area, r in each("Tab8_3"):
        mean, median = number(r.get("H")), number(r.get("K"))
        out[area]["income"] = mean
        out[area]["incomeMedian"] = median
        # How far the mean sits above the median: near 1 where incomes are alike, high where
        # a few pull the mean up. Both are the area's own, so the ratio is too.
        if median:
            out[area]["incomeRatio"] = mean / median
    brazil = out.pop("BR", {})
    return out, brazil


# --- Rounds -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Round:
    """Where a round's ballot-box reports live: its "pleito" on the TSE's site and the
    federal election in it (3220 and 6257 for the 1st round of 2026)."""

    id: str
    pleito: str
    federal: int

    @classmethod
    def of(cls, round_id: str) -> Round:
        return cls(
            round_id,
            tse_results.pleito(YEAR, round_id),
            int(tse_results.election(YEAR, round_id, "federal")),
        )

    @property
    def reports(self) -> str:
        return f"{tse_results.base(YEAR)}/arquivo-urna/{self.pleito}"

    @property
    def sections(self) -> Path:
        """Cache of the reports read: the 1st round kept its original folder."""
        return SECTIONS if self.id == "r1" else RAW / f"sections-{self.id}"


# --- Geometry ---------------------------------------------------------------------------


def mapshaper(*args: str) -> None:
    run = subprocess.run(
        ["npx", "--no-install", "mapshaper", *args], cwd=ROOT, capture_output=True, text=True
    )
    if run.returncode:
        raise RuntimeError(f"mapshaper failed:\n{run.stdout}{run.stderr}")


def areas_geometry(uf: str, code: str, tract_area: dict[str, str], work: Path) -> tuple[Path, list[dict]]:
    """The capital's weighting areas as GeoJSON (tracts merged), and its tracts' attributes."""
    shp_dir = work / uf
    if not shp_dir.exists():
        with zipfile.ZipFile(cached(f"setores_{uf}.zip", TRACTS.format(uf=uf))) as z:
            z.extractall(shp_dir)
    shp = next(shp_dir.glob("*.shp"))
    join = work / f"{code}_areas.csv"
    with join.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["CD_SETOR", "AREA"])
        w.writerows(tract_area.items())
    attrs = work / f"{code}_tracts.csv"
    geo = work / f"{code}_areas.json"
    mapshaper(
        str(shp),
        "-filter", f"CD_MUN=='{code}'",
        "-join", str(join), "keys=CD_SETOR,CD_SETOR", "string-fields=CD_SETOR,AREA",
        "-filter", "AREA != null",
        "-filter-fields", "CD_SETOR,AREA,CD_BAIRRO,NM_BAIRRO,CD_DIST,NM_DIST,CD_SUBDIST,NM_SUBDIST,v0001",
        "-o", str(attrs), "format=csv",
        "-dissolve", "AREA",
        "-o", str(geo), "format=geojson", "precision=0.00001",
    )  # fmt: skip
    with attrs.open(encoding="utf-8") as f:
        return geo, list(csv.DictReader(f))


def contains(geometry: dict, x: float, y: float) -> bool:
    """Point in a GeoJSON Polygon or MultiPolygon (even–odd rule, holes included)."""
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    inside = False
    for poly in polys:
        for ring in poly:
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, yi = ring[i]
                xj, yj = ring[j]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    inside = not inside
                j = i
    return inside


# --- Votes ------------------------------------------------------------------------------


def der(b: bytes, i: int) -> tuple[int, bool, int, int, int]:
    """One DER element at i: (class, constructed, tag number, value start, value end)."""
    t = b[i]
    i += 1
    num = t & 0x1F
    if num == 0x1F:
        num = 0
        while True:
            x = b[i]
            i += 1
            num = (num << 7) | (x & 0x7F)
            if not x & 0x80:
                break
    n = b[i]
    i += 1
    if n & 0x80:
        k = n & 0x7F
        n = int.from_bytes(b[i : i + k], "big")
        i += k
    return t >> 6, bool(t & 0x20), num, i, i + n


def children(b: bytes, start: int, end: int) -> list[tuple[int, bool, int, int, int]]:
    out = []
    while start < end:
        el = der(b, start)
        out.append(el)
        start = el[4]
    return out


def integer(b: bytes, el: tuple) -> int:
    return int.from_bytes(b[el[3] : el[4]], "big", signed=True)


def is_by_election(b: bytes, seq: tuple, federal: int) -> bool:
    """Whether a sequence is resultadosVotacaoPorEleicao: items opening with an election id."""
    items = children(b, seq[3], seq[4])
    if not items or not all(i[1] for i in items):
        return False
    first = children(b, items[0][3], items[0][4])
    return bool(first) and not first[0][1] and integer(b, first[0]) in (federal, federal + 2)


def president_votes(bu: bytes, federal: int) -> dict[int, int]:
    """Ballot number → votes for president in one ballot-box report; -1 blank, -2 null.

    The file is an envelope whose last field holds the report (TSE's ASN.1 module
    "BoletimUrna"): resultadosVotacaoPorEleicao → per election, resultadosVotacao →
    per office type, totaisVotosCargo → per office, totaisVotosVotavel → per choice:
    [1] tipoVoto (1 nominal, 2 blank, 3 null), [2] votes, [3] {party, number}.
    """
    outer = der(bu, 0)
    report = children(bu, outer[3], outer[4])[-1]
    root = der(bu, report[3])
    fields = children(bu, root[3], root[4])
    by_election = next(f for f in fields if f[1] and f[2] == 16 and is_by_election(bu, f, federal))
    out: dict[int, int] = {}
    for election in children(bu, by_election[3], by_election[4]):
        parts = children(bu, election[3], election[4])
        if integer(bu, parts[0]) != federal:
            continue
        results = next(p for p in parts if p[1])
        for office_type in children(bu, results[3], results[4]):
            for f in children(bu, office_type[3], office_type[4]):
                if not f[1]:
                    continue
                for office in children(bu, f[3], f[4]):
                    o = children(bu, office[3], office[4])
                    if integer(bu, o[0]) != PRESIDENT:
                        continue
                    for choice in children(bu, o[-1][3], o[-1][4]):
                        c = {el[2]: el for el in children(bu, choice[3], choice[4]) if el[0] == 2}
                        kind, votes = integer(bu, c[1]), integer(bu, c[2])
                        if kind == 1 and 3 in c:
                            ident = children(bu, c[3][3], c[3][4])
                            out[integer(bu, ident[-1])] = votes
                        elif kind in (2, 3):
                            out[-(kind - 1)] = votes
    return out


def section_votes(rnd: Round, uf: str, tse: str, zone: str, section: str) -> dict[int, int] | None:
    """A section's president count; None for sections merged into another (no report of
    their own: 404) or when the TSE keeps failing."""
    base = f"{rnd.reports}/dados/{uf}/{tse}/{zone}/{section}"
    for attempt in range(4):
        try:
            aux = json.loads(get(f"{base}/p00{rnd.pleito}-{uf}-m{tse}-z{zone}-s{section}-aux.json"))
            for h in aux["hashes"]:
                name = next((a["nm"] for a in h["arq"] if a["tp"] == "bu"), None)
                if name:
                    return president_votes(get(f"{base}/{h['hash']}/{name}"), rnd.federal)
            return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            error = e
        except (urllib.error.URLError, TimeoutError, ValueError, IndexError, StopIteration) as e:
            error = e
        # The TSE's servers shed load under bursts: wait and try again.
        time.sleep(2 * (attempt + 1))
    print(f"    {uf} {zone}/{section}: {type(error).__name__}", file=sys.stderr)
    return None


def capital_votes(rnd: Round, uf: str, tse: str, code: str) -> dict[str, dict[int, int]]:
    """'zone/section' → president votes, for every section of a capital. Cached; a rerun
    fetches only the sections still missing (sections merged into another stay missing)."""
    path = rnd.sections / f"{code}.json"
    out: dict[str, dict[int, int]] = {}
    if path.exists():
        out = {k: {int(n): v for n, v in d.items()} for k, d in json.loads(path.read_text()).items()}
    config = json.loads(get(f"{rnd.reports}/config/{uf}/{uf}-p00{rnd.pleito}-cs.json"))
    places = [
        (z["cd"], s["ns"])
        for a in config["abr"]
        for m in a["mu"]
        if m["cd"] == tse
        for z in m["zon"]
        for s in z["sec"]
    ]
    todo = [(z, s) for z, s in places if f"{z}/{s}" not in out]
    print(f"  {CAPITALS[code]}: {len(places)} sections, {len(todo)} to read", flush=True)
    with ThreadPoolExecutor(WORKERS) as pool:
        got = list(pool.map(lambda p: section_votes(rnd, uf, tse, p[0], p[1]), todo))
    out.update({f"{z}/{s}": v for (z, s), v in zip(todo, got, strict=True) if v is not None})
    rnd.sections.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out), encoding="utf-8")
    return out


def polling_places(uf: str, tse: str) -> tuple[dict[str, tuple[float, float]], set[str]]:
    """'zone/section' → (longitude, latitude) of its polling place; and the sections with a
    report of their own (not merged into another)."""
    with zipfile.ZipFile(cached("locais_votacao_2026.zip", PLACES)) as z:
        name = f"eleitorado_local_votacao_2026_{uf.upper()}.csv"
        text = io.TextIOWrapper(z.open(name), encoding="latin-1")
        out = {}
        own: set[str] = set()
        for r in csv.DictReader(text, delimiter=";"):
            if r["CD_MUNICIPIO"] != tse:
                continue
            key = f"{int(r['NR_ZONA']):04d}/{int(r['NR_SECAO']):04d}"
            if r["DS_TIPO_SECAO_AGREGADA"] != "Agregada":
                own.add(key)
            try:
                lat = float(r["NR_LATITUDE"].replace(",", "."))
                lon = float(r["NR_LONGITUDE"].replace(",", "."))
            except ValueError:
                continue
            if lat == -1 or lon == -1:
                continue
            out[key] = (lon, lat)
        return out, own


def check(rnd: Round, code: str, uf: str, tse: str, votes: dict[str, dict[int, int]]) -> None:
    """The reports read must add up to the TSE's own count for the municipality."""
    official = apuracao_cidades.read(str(rnd.federal), PRESIDENT, uf, tse)
    if not official:
        return
    pt = sum(v.get(PT, 0) for v in votes.values())
    valid = sum(n for v in votes.values() for k, n in v.items() if k > 0)
    by_party = {p: n for _, p, n in official["cands"]}
    ours, theirs = pt / valid * 100, by_party.get("PT", 0) / official["valid"] * 100
    flag = "" if abs(ours - theirs) < 0.1 else "  <-- differs"
    print(f"  {CAPITALS[code]}: PT {ours:.2f}% from the reports, {theirs:.2f}% in the TSE's count{flag}")


# --- Build ------------------------------------------------------------------------------


# --- Census universe: colour or race, age, same-sex couples (every person, by tract) ------

TRACT_FILES = IBGE + "/Agregados_por_Setores_Censitarios/Agregados_por_Setor_csv/Agregados_por_setores_{}.zip"
# Variables of the tract files (dictionary of 20/05/2026): people by colour or race; people by
# age group (0 to 4 … 70 or more, both sexes); households with a couple only of different sex,
# only of the same sex, and both.
RACE = {"white": "V01317", "black": "V01318", "asian": "V01319", "brown": "V01320", "indigenous": "V01321"}
AGE = {f"age{k}": f"V0{1031 + k}" for k in range(11)}  # V01031 (0 to 4) … V01041 (70 or more)
ELDERLY = ("age9", "age10")  # 60 to 69, 70 or more
COUPLES = {"coupleOther": "V01176", "coupleSame": "V01177", "coupleBoth": "V01178"}
# Permanent private households (domicílios particulares permanentes ocupados): all, and those
# that are flats; with 2, 3, 4 or more bathrooms of their own; with the sewage in the public
# network (rede geral ou pluvial).
HOMES = {"homes": "V00001", "flat": "V00049"}
HOMES2 = {"bath2": "V00233", "bath3": "V00234", "bath4": "V00235", "sewer": "V00309"}
# People 15 or more by age group (15 to 19 … 80 or more), and those who can read and write.
READ = {
    **{f"read{k}": f"V00{644 + k}" for k in range(13)},
    **{f"literate{k}": f"V00{748 + k}" for k in range(13)},
}
COUNTS = (*RACE, *AGE, *COUPLES, *HOMES, *HOMES2, *READ)
# Each file and the name of its latest version on the IBGE's server.
TRACT_TABLES: tuple[tuple[str, str, dict[str, str]], ...] = (
    ("cor_ou_raca", "cor_ou_raca_BR", RACE),
    ("demografia", "demografia_BR", AGE),
    ("parentesco", "parentesco_BR", COUPLES),
    ("caracteristicas_domicilio1", "caracteristicas_domicilio1_BR", HOMES),
    ("caracteristicas_domicilio2", "caracteristicas_domicilio2_BR_20250417", HOMES2),
    ("alfabetizacao", "alfabetizacao_BR", READ),
)


def universe(codes: set[str]) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """Tract → counts of people by colour or race, age and literacy, and of households by
    couple, kind, bathrooms and sewage, for the municipalities asked; and the same counts
    summed over Brazil. Cells hidden for privacy ("X") count as zero: summed so, tracts give
    exactly the IBGE's own district and municipal totals (checked for São Paulo)."""
    out: dict[str, dict[str, float]] = defaultdict(dict)
    brazil: dict[str, float] = defaultdict(float)
    for kind, name, variables in TRACT_TABLES:
        with (
            zipfile.ZipFile(cached(f"setores_{kind}.zip", TRACT_FILES.format(name))) as z,
            z.open(z.namelist()[0]) as raw,
        ):
            rows = csv.reader(io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";")
            head = [h.strip('"') for h in next(rows)]
            cols = {key: head.index(var) for key, var in variables.items()}
            for row in rows:
                tract = row[0].strip('"')
                got = {k: number(row[i].strip('"')) for k, i in cols.items()}
                for k, x in got.items():
                    brazil[k] += x
                if tract[:7] in codes:
                    out[tract].update(got)
    return out, dict(brazil)


def share(part: float, whole: float, digits: int = 1) -> float | None:
    return round(part / whole * 100, digits) if whole else None


def social(counts: dict[str, float]) -> dict[str, float | None]:
    """Shares from summed counts: each colour or race of the people; "negro" (preto and pardo,
    as the IBGE and the Estatuto da Igualdade Racial group them); people aged 60 or more (the
    Estatuto da Pessoa Idosa's line); the share of couple households with a same-sex couple;
    of homes that are flats, that have two bathrooms or more, whose sewage goes to the network;
    and of people 15 or more who cannot read and write."""
    c = lambda k: counts.get(k, 0)  # noqa: E731
    people = sum(c(k) for k in RACE)
    out: dict[str, float | None] = {k: share(c(k), people) for k in RACE}
    out["negro"] = share(c("black") + c("brown"), people)
    out["elderly"] = share(sum(c(k) for k in ELDERLY), sum(c(k) for k in AGE))
    out["sameSex"] = share(c("coupleSame") + c("coupleBoth"), sum(c(k) for k in COUPLES), 2)
    out["flat"] = share(c("flat"), c("homes"))
    out["bathrooms"] = share(c("bath2") + c("bath3") + c("bath4"), c("homes"))
    out["sewer"] = share(c("sewer"), c("homes"))
    readers = sum(c(f"read{k}") for k in range(13))
    literate = share(sum(c(f"literate{k}") for k in range(13)), readers)
    out["illiterate"] = None if literate is None else round(100 - literate, 1)
    return out


def summed(tracts: list[str], counts: dict[str, dict[str, float]]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for t in tracts:
        for k, v in counts.get(t, {}).items():
            out[k] += v
    return out


# --- Build ------------------------------------------------------------------------------

SAMPLE = ("income", "incomeMedian", "incomeRatio", "eduBasic", "eduFund", "eduMid", "degree", "schoolYears",
          "catholic", "evangelical", "spiritist", "afro", "noReligion", "otherReligion", "unemployed",
          "commuteLong", "commuteWalk", "commuteMoto", "commuteCar", "commuteTransit", "renting",
          "poorWalls", "noInternet", "migrant")  # fmt: skip
# Digits kept: reais whole, the mean-to-median ratio to the hundredth, shares to the tenth.
DIGITS = {"income": 0, "incomeMedian": 0, "incomeRatio": 2}


def place(
    features: list[tuple[str, dict]],
    places: dict[str, tuple[float, float]],
    own: set[str],
    votes: dict[str, dict[int, int]],
) -> dict:
    """Each section's votes summed in the unit its polling place falls in; how many sections
    with a report each unit has and how many of those were read; the share of votes placed."""
    where_unit: dict[tuple[float, float], str | None] = {}

    def unit_of(key: str) -> str | None:
        where = places.get(key)
        if where is None:
            return None
        if where not in where_unit:  # many sections share a polling place
            where_unit[where] = next((u for u, g in features if contains(g, *where)), None)
        return where_unit[where]

    expected: dict[str, int] = defaultdict(int)
    for key in own:
        if u := unit_of(key):
            expected[u] += 1
    tally: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    read: dict[str, int] = defaultdict(int)
    placed = lost = 0
    for key, v in votes.items():
        unit = unit_of(key)
        total = sum(n for k, n in v.items() if k > 0)
        if unit is None:
            lost += total
            continue
        placed += total
        read[unit] += 1
        for k, n in v.items():
            tally[unit][k] += n
    return {"tally": tally, "read": read, "expected": expected, "placed": placed, "lost": lost}


def vote_fields(v: dict[int, int], read: int, expected: int) -> dict:
    valid = sum(n for k, n in v.items() if k > 0)
    return {
        "valid": valid,
        "pt": round(v.get(PT, 0) / valid * 100, 1) if valid else None,
        "rival": round(v.get(RIVAL, 0) / valid * 100, 1) if valid else None,
        "coverage": round(min(1, read / expected) * 100) if expected else None,
    }


def sample_fields(c: dict) -> dict:
    out: dict[str, float | None] = {}
    for k in SAMPLE:
        digits = DIGITS.get(k, 1)
        out[k] = None if c.get(k) is None else round(c[k]) if digits == 0 else round(c[k], digits)
    return out


def gini_between(areas: list[dict]) -> float | None:
    """Gini of the household income per person if everyone in an area had the area's mean:
    the inequality between areas only, so below the city's true Gini (which counts the
    inequality inside each area too, and the census does not publish by area)."""
    rows = [(a["population"], a["income"]) for a in areas if a.get("income") and a["population"]]
    people = sum(w for w, _ in rows)
    total = sum(w * x for w, x in rows)
    if len(rows) < 2 or not total:
        return None
    # Sorted by income, Σ w_i·x_i·(2·(people below i) + w_i − people) over people·total.
    rows.sort(key=lambda r: r[1])
    below = acc = 0.0
    for w, x in rows:
        acc += w * x * (2 * below + w - people)
        below += w
    return round(acc / (people * total), 3)


def weighted(parts: list[tuple[float, dict]]) -> dict:
    """Sample figures of a larger unit: its parts' figures, weighted by their people."""
    out = {}
    for k in SAMPLE:
        known = [(w, d[k]) for w, d in parts if d.get(k) is not None and w]
        total = sum(w for w, _ in known)
        out[k] = sum(w * x for w, x in known) / total if total else None
    return out


# Where an area has no neighbourhood (São Paulo, Brasília…), it is named by its region or
# district: the weighting areas carry no name of their own.
AREA_NAMES = ("NM_BAIRRO", "NM_SUBDIST", "NM_DIST")


def area_names(area: str, named: dict[str, dict[str, dict[str, float]]]) -> list[str]:
    """The area's names at the finest level that has any, most populous first."""
    for f in AREA_NAMES:
        if people := named[f].get(area):
            return sorted(people, key=lambda n: -people[n])
    return []


def build_capital(
    rnd: Round, code: str, uf: str, tse: str, tract_area: dict, census: dict, counts: dict, work: Path
) -> dict:
    geo_path, tracts = areas_geometry(uf.upper(), code, tract_area, work)
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    population: dict[str, float] = defaultdict(float)
    # People per name in each area, at each of the IBGE's levels of names, finest first.
    named: dict[str, dict[str, dict[str, float]]] = {
        f: defaultdict(lambda: defaultdict(float)) for f in AREA_NAMES
    }
    tracts_of: dict[str, list[str]] = defaultdict(list)
    for t in tracts:
        population[t["AREA"]] += number(t["v0001"])
        tracts_of[t["AREA"]].append(t["CD_SETOR"])
        for f in AREA_NAMES:
            # A district named as the city says nothing (most capitals are one district).
            if t.get(f) and t[f] != CAPITALS[code]:
                named[f][t["AREA"]][t[f]] += number(t["v0001"])

    votes = capital_votes(rnd, uf, tse, code)
    places, own = polling_places(uf, tse)
    features = [(f["properties"]["AREA"], f["geometry"]) for f in geo["features"]]
    p = place(features, places, own, votes)

    areas = []
    for area, _ in sorted(features):
        names = area_names(area, named)
        areas.append(
            {
                "id": area,
                "bairros": names,
                "population": round(population[area]),
                **sample_fields(census.get(area, {})),
                **social(summed(tracts_of[area], counts)),
                **vote_fields(p["tally"].get(area, {}), p["read"][area], p["expected"][area]),
            }
        )
    share = p["placed"] / (p["placed"] + p["lost"]) * 100 if p["placed"] + p["lost"] else 0
    missing = len([k for k in own if k not in votes])
    check(rnd, code, uf, tse, votes)
    print(
        f"  {CAPITALS[code]}: {len(areas)} areas, {len(votes)} sections read, "
        f"{share:.1f}% of valid votes placed in an area, {missing} reports not published yet"
    )
    out = {
        "code": code,
        "name": CAPITALS[code],
        "uf": uf.upper(),
        "placed": round(share, 1),
        "missing": missing,
        "sections": len(own),
        "giniAreas": gini_between(areas),
        "areas": areas,
    }
    ctx = {"tracts": tracts, "census": census, "counts": counts, "places": places, "own": own, "votes": votes}
    units = sao_paulo_units(uf, ctx, work) if code == SAO_PAULO else {}
    if bairros := named_units(code, uf, ctx, work, "CD_BAIRRO", "NM_BAIRRO"):
        units["bairros"] = bairros
    # Regions by name: a city split in districts repeats a region's name under each district's
    # code (Belo Horizonte), and tracts outside any region have a code but no name.
    if regions := named_units(code, uf, ctx, work, "NM_SUBDIST", "NM_SUBDIST"):
        units["regions"] = numbered(regions, f"{code}R")
    if units:
        out["units"] = units
    return out


# --- São Paulo: districts and subprefeituras --------------------------------------------

SAO_PAULO = "3550308"


def subprefeituras() -> dict[str, str]:
    """IBGE district name (plain) → subprefeitura, from data/sp_subprefeituras.yaml."""
    config = yaml.safe_load((DATA / "sp_subprefeituras.yaml").read_text(encoding="utf-8"))
    to_ibge = config.get("ibge_names") or {}
    return {
        plain(to_ibge.get(d, d)): sub
        for sub, districts in config["subprefeituras"].items()
        for d in districts
    }


def plain(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z ]", " ", text).split())


def unit_topology(geojson: Path, field: str, work: Path) -> dict:
    out = work / f"{geojson.stem}.topo.json"
    mapshaper(
        str(geojson), "-rename-layers", "areas", "-simplify", "8%", "keep-shapes",
        "-o", str(out), "format=topojson", "quantization=100000", f"id-field={field}",
    )  # fmt: skip
    topo = json.loads(out.read_text(encoding="utf-8"))
    for g in topo["objects"]["areas"]["geometries"]:
        g.pop("properties", None)
    return topo


class TractUnits:
    """A capital cut along a tract field (district, neighbourhood): each unit's outline (its
    tracts dissolved), the vote placed in it and its census: colour or race and couples
    summed from its tracts; income, schooling and religion (published by weighting area only)
    from the areas of its tracts, weighted by the tracts' people. Units can be grouped
    further (São Paulo's districts into subprefeituras)."""

    def __init__(
        self, code: str, uf: str, field: str, name_field: str, ctx: dict, work: Path, join: Path | None = None
    ) -> None:
        """`join`: a CSV giving each tract (CD_SETOR) the unit fields, when the IBGE's files
        have none (São Paulo's neighbourhoods from OpenStreetMap)."""
        self.work = work
        shp = next((work / uf.upper()).glob("*.shp"))
        self.geo_path = work / f"{code}_{field}.json"
        joined = (
            ["-join", str(join), "keys=CD_SETOR,CD_SETOR", f"string-fields=CD_SETOR,{field},{name_field}"]
            if join
            else []
        )
        mapshaper(
            str(shp), "-filter", f"CD_MUN=='{code}'", *joined,
            "-filter", f"{field} != null && {field} != '.' && {field} != ''",
            "-dissolve", field, *([f"copy-fields={name_field}"] if name_field != field else []),
            "-o", str(self.geo_path), "format=geojson", "precision=0.00001",
        )  # fmt: skip
        self.geo = json.loads(self.geo_path.read_text(encoding="utf-8"))
        self.field = field
        self.names = {f["properties"][field]: f["properties"][name_field] for f in self.geo["features"]}
        by_unit: dict[str, list[dict]] = defaultdict(list)
        for t in ctx["tracts"]:
            if t.get(field) in self.names:
                by_unit[t[field]].append(t)
        census, counts = ctx["census"], ctx["counts"]
        self.stats = {
            u: {
                "population": sum(number(t["v0001"]) for t in ts),
                "counts": summed([t["CD_SETOR"] for t in ts], counts),
                "sample": weighted([(number(t["v0001"]), census.get(t["AREA"], {})) for t in ts]),
            }
            for u, ts in ((u, by_unit[u]) for u in self.names)
        }
        features = [(f["properties"][field], f["geometry"]) for f in self.geo["features"]]
        self.placed = place(features, ctx["places"], ctx["own"], ctx["votes"])

    def record(self, uid: str, name: str, members: list[str]) -> dict:
        p = self.placed
        tally: dict[int, int] = defaultdict(int)
        for m in members:
            for k, n in p["tally"].get(m, {}).items():
                tally[k] += n
        parts = [self.stats[m] for m in members]
        counted: dict[str, float] = defaultdict(float)
        for st in parts:
            for k, v in st["counts"].items():
                counted[k] += v
        return {
            "id": uid,
            "bairros": [name],
            "population": round(sum(st["population"] for st in parts)),
            **sample_fields(weighted([(st["population"], st["sample"]) for st in parts])),
            **social(counted),
            **vote_fields(tally, sum(p["read"][m] for m in members), sum(p["expected"][m] for m in members)),
        }

    def units(self) -> dict:
        rows = [self.record(u, self.names[u], [u]) for u in sorted(self.names)]
        return {"areas": rows, "topology": unit_topology(self.geo_path, self.field, self.work)}


# Neighbourhoods, and regions (the IBGE's subdistricts: most cities' administrative regions,
# Brasília's regiões administrativas), as a level where the IBGE's names cover nearly the
# whole city (some capitals have none, or only part of the city).
NAMED_COVER = 0.9


def named_units(code: str, uf: str, ctx: dict, work: Path, field: str, name_field: str) -> dict | None:
    people = sum(number(t["v0001"]) for t in ctx["tracts"])
    named = [t for t in ctx["tracts"] if t.get(field) not in (None, "", ".") and t.get(name_field)]
    covered = sum(number(t["v0001"]) for t in named)
    if not people or covered / people < NAMED_COVER or len({t[field] for t in named}) < 2:
        return None
    u = TractUnits(code, uf, field, name_field, ctx, work)
    out = u.units()
    out["cover"] = round(covered / people * 100, 1)
    print(f"  {CAPITALS[code]}: {len(out['areas'])} {name_field} ({out['cover']}% of the people)")
    return out


def sao_paulo_units(uf: str, ctx: dict, work: Path) -> dict:
    """São Paulo by its 96 districts and 32 subprefeituras (data/sp_subprefeituras.yaml)."""
    sub_of = subprefeituras()
    d = TractUnits(SAO_PAULO, uf, "CD_DIST", "NM_DIST", ctx, work)
    missing = sorted(n for n in d.names.values() if plain(n) not in sub_of)
    extra = sorted(set(sub_of) - {plain(n) for n in d.names.values()})
    if missing or extra:
        raise SystemExit(f"sp_subprefeituras.yaml does not match the IBGE's districts: {missing} / {extra}")
    subs: dict[str, list[str]] = defaultdict(list)
    for code, n in d.names.items():
        subs[sub_of[plain(n)]].append(code)
    sub_ids = {s: f"{SAO_PAULO}S{k:02d}" for k, s in enumerate(sorted(subs), 1)}
    sub_rows = [d.record(sub_ids[s], s, ds) for s, ds in sorted(subs.items())]
    # Subprefeituras' outlines: the districts dissolved by the subprefeitura they belong to.
    for f in d.geo["features"]:
        f["properties"]["SUB"] = sub_ids[sub_of[plain(f["properties"]["NM_DIST"])]]
    subs_geo = work / "sp_subprefeituras.json"
    d.geo_path.write_text(json.dumps(d.geo), encoding="utf-8")
    mapshaper(str(d.geo_path), "-dissolve", "SUB", "-o", str(subs_geo), "format=geojson", "precision=0.00001")
    districts = d.units()
    print(f"  São Paulo: {len(districts['areas'])} districts, {len(sub_rows)} subprefeituras")
    bairros = osm_bairro_units(uf, ctx, work, d.geo)
    return {
        "districts": districts,
        "subprefeituras": {"areas": sub_rows, "topology": unit_topology(subs_geo, "SUB", work)},
        "bairros": bairros,
    }


# --- São Paulo: neighbourhoods from OpenStreetMap -----------------------------------------
#
# The city never made its neighbourhoods official, so the IBGE has none there (only the 96
# districts). OpenStreetMap marks them, almost all as points (place=suburb, quarter,
# neighbourhood): each tract goes to the nearest one inside its own district, and a district
# with none stays whole under its own name. Borders are thus approximate; the figures, summed
# tract by tract, are exact for the borders drawn.

OVERPASS = "https://overpass-api.de/api/interpreter"
# Area 3600298285: OpenStreetMap relation 298285, the municipality of São Paulo.
OSM_QUERY = (
    "[out:json][timeout:170];area(3600298285)->.sp;"
    '(nwr["place"~"^(suburb|quarter|neighbourhood)$"](area.sp););out tags center;'
)


def osm_places() -> list[tuple[str, float, float]]:
    """Named neighbourhood points of São Paulo in OpenStreetMap: (name, lon, lat)."""
    url = f"{OVERPASS}?{urllib.parse.urlencode({'data': OSM_QUERY})}"
    for attempt in range(4):  # the public server answers 504 when busy; downloaded once, then cached
        try:
            path = cached("osm_sp_bairros.json", url)
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 504) or attempt == 3:
                raise
            time.sleep(30 * (attempt + 1))
    out = []
    for e in json.loads(path.read_text(encoding="utf-8"))["elements"]:
        where = e.get("center", e)
        if (name := e.get("tags", {}).get("name")) and "lon" in where:
            out.append((name, where["lon"], where["lat"]))
    return out


def nearest_bairro(
    tracts: list[tuple[str, str, float, float]],
    places: list[tuple[str, float, float]],
    district_of: dict[tuple[float, float], str | None],
    district_name: dict[str, str],
) -> dict[str, str]:
    """Tract → neighbourhood name: the nearest point in the tract's own district (one per name
    in a district), else the district's name."""
    within: dict[str, dict[str, tuple[float, float]]] = defaultdict(dict)
    for name, lon, lat in places:
        if dist := district_of.get((lon, lat)):
            within[dist].setdefault(name, (lon, lat))
    out = {}
    for tract, dist, x, y in tracts:
        k = math.cos(math.radians(y))
        options = within.get(dist)
        out[tract] = (
            min(options, key=lambda n: ((options[n][0] - x) * k) ** 2 + (options[n][1] - y) ** 2)
            if options
            else district_name[dist]
        )
    return out


def osm_bairro_units(uf: str, ctx: dict, work: Path, districts: dict) -> dict:
    shp = next((work / uf.upper()).glob("*.shp"))
    points = work / "sp_tract_points.csv"
    mapshaper(
        str(shp), "-filter", f"CD_MUN=='{SAO_PAULO}'", "-points", "inner",
        "-each", "x=this.x, y=this.y", "-filter-fields", "CD_SETOR,CD_DIST,x,y",
        "-o", str(points), "format=csv",
    )  # fmt: skip
    with points.open(encoding="utf-8") as f:
        tracts = [(r["CD_SETOR"], r["CD_DIST"], float(r["x"]), float(r["y"])) for r in csv.DictReader(f)]
    shapes = [(f["properties"]["CD_DIST"], f["geometry"]) for f in districts["features"]]
    places = osm_places()
    district_of = {(x, y): next((d for d, g in shapes if contains(g, x, y)), None) for _, x, y in places}
    names = {f["properties"]["CD_DIST"]: f["properties"]["NM_DIST"] for f in districts["features"]}
    bairro = nearest_bairro(tracts, places, district_of, names)
    # A unit per district and name: a name found in two districts is two units, each told
    # apart by its district ("Vila Yolanda (Cangaíba)").
    dist_of = {t: d for t, d, _, _ in tracts}
    key = {t: f"{dist_of[t]}|{n}" for t, n in bairro.items()}
    found_in: dict[str, set[str]] = defaultdict(set)
    for t, n in bairro.items():
        found_in[n].add(dist_of[t])
    bairro = {t: f"{n} ({names[dist_of[t]]})" if len(found_in[n]) > 1 else n for t, n in bairro.items()}
    join = work / "sp_osm_bairros.csv"
    with join.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["CD_SETOR", "OSM_KEY", "OSM_NAME"])
        w.writerows((t, key[t], bairro[t]) for t in bairro)
    tagged = {
        **ctx,
        "tracts": [
            {**t, "OSM_KEY": key.get(t["CD_SETOR"]), "OSM_NAME": bairro.get(t["CD_SETOR"])}
            for t in ctx["tracts"]
        ],
    }
    u = TractUnits(SAO_PAULO, uf, "OSM_KEY", "OSM_NAME", tagged, work, join=join)
    out = numbered(u.units(), f"{SAO_PAULO}B")
    out["source"] = "osm"
    print(f"  São Paulo: {len(out['areas'])} neighbourhoods from OpenStreetMap ({len(places)} points)")
    return out


def numbered(units: dict, prefix: str) -> dict:
    """Units keyed by name get ids like the others: the city's code, a letter and a number."""
    ids = {a["id"]: f"{prefix}{k:02d}" for k, a in enumerate(units["areas"], 1)}
    for a in units["areas"]:
        a["id"] = ids[a["id"]]
    for g in units["topology"]["objects"]["areas"]["geometries"]:
        g["id"] = ids[g["id"]]
    return units


VOTE_FIELDS = ("valid", "pt", "rival", "coverage")
SECTION_FIELDS = ("placed", "missing", "sections")


def runoff_areas(first: list[dict], runoff: list[dict]) -> list[dict]:
    by_id = {a["id"]: a for a in runoff}
    return [
        {**a, "r2": {k: by_id[a["id"]][k] for k in VOTE_FIELDS}} if a["id"] in by_id else a for a in first
    ]


def runoff_of(capital: dict) -> dict:
    """What `with_runoff` added, taken back out (to keep it when the 1st round is rebuilt)."""

    def only(areas: list[dict]) -> list[dict]:
        return [{"id": a["id"], **a["r2"]} for a in areas if "r2" in a]

    out = {**capital["r2"], "areas": only(capital["areas"])}
    if "units" in capital:
        out["units"] = {level: {"areas": only(u["areas"])} for level, u in capital["units"].items()}
    return out


def with_runoff(first: dict, runoff: dict) -> dict:
    """The 1st-round capital with the runoff's vote beside it, area by area, under "r2"."""
    out = {
        **first,
        "r2": {k: runoff[k] for k in SECTION_FIELDS},
        "areas": runoff_areas(first["areas"], runoff["areas"]),
    }
    if "units" in first and "units" in runoff:
        out["units"] = {
            # A level added since the runoff was read has no runoff vote until it is read again.
            level: {**u, "areas": runoff_areas(u["areas"], runoff["units"].get(level, {}).get("areas", []))}
            for level, u in first["units"].items()
        }
    return out


def main() -> int:
    args = sys.argv[1:]
    round_id = "r2" if "r2" in args else "r1"
    try:
        rnd = Round.of(round_id)
    except tse_results.NotPublished as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    asked = [c for c in args if c in CAPITALS] or list(CAPITALS)
    federal = str(Round.of("r1").federal)  # every municipality: the 1st round lists them all
    places = {ibge: (uf, tse) for uf, tse, ibge in apuracao_cidades.municipalities(federal)}
    codes = set(asked)
    print("reading the IBGE's weighting areas…", flush=True)
    tract_area = composition(codes)
    census, brazil_sample = area_tables(codes)
    print("reading colour or race, age, couples, homes and literacy by tract…", flush=True)
    counts, brazil_counts = universe(codes)
    out = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"capitals": []}
    by_code = {c["code"]: c for c in out["capitals"]}
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        geos = []
        for code in asked:
            uf, tse = places[code]
            mine = {t: a for t, a in tract_area.items() if a.startswith(code)}
            built = build_capital(rnd, code, uf, tse, mine, census, counts, work)
            if rnd.id == "r1":
                # A rebuilt 1st round keeps the runoff already read, if any.
                old = by_code.get(code)
                if old and "r2" in old:
                    built = with_runoff(built, runoff_of(old))
                by_code[code] = built
            elif code in by_code:
                by_code[code] = with_runoff(by_code[code], built)
            else:
                print(f"  {CAPITALS[code]}: no 1st round yet; run without r2 first", file=sys.stderr)
            geos.append(work / f"{code}_areas.json")
        # Every capital's areas in one simplified TopoJSON object, keyed by area id.
        old = RAW / "areas_topology_parts"
        old.mkdir(parents=True, exist_ok=True)
        for g in geos:
            (old / g.name).write_bytes(g.read_bytes())
        parts = sorted(str(p) for p in old.glob("*_areas.json"))
        topo = work / "areas.topo.json"
        mapshaper(
            "-i", *parts, "combine-files",
            "-merge-layers", "force", "name=areas",
            "-simplify", "8%", "keep-shapes",
            "-o", str(topo), "format=topojson", "quantization=100000", "id-field=AREA",
        )  # fmt: skip
        topology = json.loads(topo.read_text(encoding="utf-8"))
    for g in topology["objects"]["areas"]["geometries"]:
        g.pop("properties", None)
    out = {
        "capitals": sorted(by_code.values(), key=lambda c: c["name"]),
        # The same figures for the whole country, to set each place against.
        "brazil": {**sample_fields(brazil_sample), **social(brazil_counts)},
        "topology": topology,
    }
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
