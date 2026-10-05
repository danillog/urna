"""Builds data/generated/capitals.json: the 2026 vote inside each state capital, area by area.

    uv run python -m pipeline.capitals              # every capital
    uv run python -m pipeline.capitals 2611606      # some, by IBGE code

The unit is the IBGE's weighting area (área de ponderação): groups of neighbourhoods
for which the 2022 Census sample is published, so religion, schooling and income
exist for each (1,472 in the capitals; 332 in São Paulo, 12 in Macapá).

Inputs, downloaded once into data/raw/capitals/ (not in git):
- IBGE, census tracts with attributes (setores, 2022), per state: geometry, the
  neighbourhood name and the population of each tract.
- IBGE, which tracts make each weighting area ("Composição das Áreas de Ponderação").
- IBGE, sample results by weighting area: religion (table 4.1), schooling of people
  aged 25+ (2.2), household income per person (8.3).
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
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import apuracao_cidades
from .build import DATA
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
TSE = "https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3220"
# The 2026 general election's "pleito" on the TSE's site, and the federal election in it.
PLEITO, FEDERAL = "3220", 6257
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


def area_tables(codes: set[str]) -> dict[str, dict]:
    """Weighting area → census sample figures."""
    tables = zipfile.ZipFile(cached("areas_de_ponderacao_tabelas.zip", AP_TABLES))
    out: dict[str, dict] = defaultdict(dict)

    def each(name: str):
        for r in xlsx_rows(tables.read(name)):
            if r.get("A") in codes and r.get("C"):
                yield r

    for r in each("Tab4_1.xlsx"):
        total = number(r.get("E"))
        if total:
            out[r["C"]].update(
                name=r.get("D"),
                catholic=number(r.get("F")) / total * 100,
                evangelical=number(r.get("G")) / total * 100,
                noReligion=number(r.get("L")) / total * 100,
            )
    for r in each("Tab2_2.xlsx"):
        total = number(r.get("E"))
        if total:
            out[r["C"]]["degree"] = number(r.get("I")) / total * 100
    for r in each("Tab8_3.xlsx"):
        out[r["C"]]["income"] = number(r.get("H"))
    return out


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
        "-filter-fields", "CD_SETOR,AREA,NM_BAIRRO,v0001",
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


def is_by_election(b: bytes, seq: tuple) -> bool:
    """Whether a sequence is resultadosVotacaoPorEleicao: items opening with an election id."""
    items = children(b, seq[3], seq[4])
    if not items or not all(i[1] for i in items):
        return False
    first = children(b, items[0][3], items[0][4])
    return bool(first) and not first[0][1] and integer(b, first[0]) in (FEDERAL, FEDERAL + 2)


def president_votes(bu: bytes) -> dict[int, int]:
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
    by_election = next(f for f in fields if f[1] and f[2] == 16 and is_by_election(bu, f))
    out: dict[int, int] = {}
    for election in children(bu, by_election[3], by_election[4]):
        parts = children(bu, election[3], election[4])
        if integer(bu, parts[0]) != FEDERAL:
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


def section_votes(uf: str, tse: str, zone: str, section: str) -> dict[int, int] | None:
    """A section's president count; None for sections merged into another (no report of
    their own: 404) or when the TSE keeps failing."""
    base = f"{TSE}/dados/{uf}/{tse}/{zone}/{section}"
    for attempt in range(4):
        try:
            aux = json.loads(get(f"{base}/p00{PLEITO}-{uf}-m{tse}-z{zone}-s{section}-aux.json"))
            for h in aux["hashes"]:
                name = next((a["nm"] for a in h["arq"] if a["tp"] == "bu"), None)
                if name:
                    return president_votes(get(f"{base}/{h['hash']}/{name}"))
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


def capital_votes(uf: str, tse: str, code: str) -> dict[str, dict[int, int]]:
    """'zone/section' → president votes, for every section of a capital. Cached; a rerun
    fetches only the sections still missing (sections merged into another stay missing)."""
    path = SECTIONS / f"{code}.json"
    out: dict[str, dict[int, int]] = {}
    if path.exists():
        out = {k: {int(n): v for n, v in d.items()} for k, d in json.loads(path.read_text()).items()}
    config = json.loads(get(f"{TSE}/config/{uf}/{uf}-p00{PLEITO}-cs.json"))
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
        got = list(pool.map(lambda p: section_votes(uf, tse, p[0], p[1]), todo))
    out.update({f"{z}/{s}": v for (z, s), v in zip(todo, got, strict=True) if v is not None})
    SECTIONS.mkdir(parents=True, exist_ok=True)
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


def check(code: str, uf: str, tse: str, votes: dict[str, dict[int, int]]) -> None:
    """The reports read must add up to the TSE's own count for the municipality."""
    official = apuracao_cidades.read(str(FEDERAL), PRESIDENT, uf, tse)
    if not official:
        return
    pt = sum(v.get(PT, 0) for v in votes.values())
    valid = sum(n for v in votes.values() for k, n in v.items() if k > 0)
    by_party = {p: n for _, p, n in official["cands"]}
    ours, theirs = pt / valid * 100, by_party.get("PT", 0) / official["valid"] * 100
    flag = "" if abs(ours - theirs) < 0.1 else "  <-- differs"
    print(f"  {CAPITALS[code]}: PT {ours:.2f}% from the reports, {theirs:.2f}% in the TSE's count{flag}")


# --- Build ------------------------------------------------------------------------------


def build_capital(code: str, uf: str, tse: str, tract_area: dict, census: dict, work: Path) -> dict:
    geo_path, tracts = areas_geometry(uf.upper(), code, tract_area, work)
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    population: dict[str, float] = defaultdict(float)
    bairros: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for t in tracts:
        population[t["AREA"]] += number(t["v0001"])
        if t["NM_BAIRRO"]:
            bairros[t["AREA"]][t["NM_BAIRRO"]] += number(t["v0001"])

    votes = capital_votes(uf, tse, code)
    places, own = polling_places(uf, tse)
    features = [(f["properties"]["AREA"], f["geometry"]) for f in geo["features"]]
    where_area: dict[tuple[float, float], str | None] = {}

    def area_of(key: str) -> str | None:
        where = places.get(key)
        if where is None:
            return None
        if where not in where_area:  # many sections share a polling place
            where_area[where] = next((a for a, g in features if contains(g, *where)), None)
        return where_area[where]

    # Sections with a report of their own, per area, and how many of those were read:
    # the TSE may not have published every report yet.
    expected: dict[str, int] = defaultdict(int)
    for key in own:
        if a := area_of(key):
            expected[a] += 1
    tally: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    read: dict[str, int] = defaultdict(int)
    placed = lost = 0
    for key, v in votes.items():
        area = area_of(key)
        total = sum(n for k, n in v.items() if k > 0)
        if area is None:
            lost += total
            continue
        placed += total
        read[area] += 1
        for k, n in v.items():
            tally[area][k] += n

    areas = []
    for area, _ in sorted(features):
        c = census.get(area, {})
        v = tally.get(area, {})
        valid = sum(n for k, n in v.items() if k > 0)
        names = sorted(bairros[area], key=lambda b: -bairros[area][b])
        areas.append(
            {
                "id": area,
                "bairros": names,
                "population": round(population[area]),
                "income": round(c["income"]) if "income" in c else None,
                "degree": round(c["degree"], 1) if "degree" in c else None,
                "evangelical": round(c["evangelical"], 1) if "evangelical" in c else None,
                "catholic": round(c["catholic"], 1) if "catholic" in c else None,
                "noReligion": round(c["noReligion"], 1) if "noReligion" in c else None,
                "valid": valid,
                "pt": round(v.get(PT, 0) / valid * 100, 1) if valid else None,
                "rival": round(v.get(RIVAL, 0) / valid * 100, 1) if valid else None,
                "coverage": round(min(1, read[area] / expected[area]) * 100) if expected[area] else None,
            }
        )
    share = placed / (placed + lost) * 100 if placed + lost else 0
    missing = len([k for k in own if k not in votes])
    check(code, uf, tse, votes)
    print(
        f"  {CAPITALS[code]}: {len(areas)} areas, {len(votes)} sections read, "
        f"{share:.1f}% of valid votes placed in an area, {missing} reports not published yet"
    )
    return {
        "code": code,
        "name": CAPITALS[code],
        "uf": uf.upper(),
        "placed": round(share, 1),
        "missing": missing,
        "sections": len(own),
        "areas": areas,
    }


def main() -> int:
    asked = [c for c in sys.argv[1:] if c in CAPITALS] or list(CAPITALS)
    places = {ibge: (uf, tse) for uf, tse, ibge in apuracao_cidades.municipalities("6257")}
    codes = set(asked)
    print("reading the IBGE's weighting areas…", flush=True)
    tract_area = composition(codes)
    census = area_tables(codes)
    out = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"capitals": []}
    by_code = {c["code"]: c for c in out["capitals"]}
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        geos = []
        for code in asked:
            uf, tse = places[code]
            mine = {t: a for t, a in tract_area.items() if a.startswith(code)}
            by_code[code] = build_capital(code, uf, tse, mine, census, work)
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
        "topology": topology,
    }
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
