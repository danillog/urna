"""Builds data/generated/profiles.json: who was elected in 2026, where they came from.

    uv run python -m pipeline.profiles

People: the governors elected in the 1st round (and the pairs going to the runoff), the
senators elected in 2026 and the 27 elected in 2022 who stay until 2031, and the 513
federal deputies (the TSE's list once published; until then our projection by the
electoral quotient, flagged as such).

For each: ballot name, party, state, age at inauguration, birthplace, schooling and
declared occupation (TSE, candidates 2026); every candidacy since 2010 and its result,
linked across elections by the voter registration number (TSE, candidates 2010–2024);
and, for those already in Congress, the office's contact, website and social networks
(Câmara and Senado open data). Contacts are those of the current term (to January 2027).

Personal identifiers in the sources (CPF, voter registration) are used only to link
records and are never written out. Inputs are cached in data/raw/profiles/ (not in git).
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.error
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from .build import DATA
from .congress import project_seats
from .sources.http import get

RAW = DATA / "raw" / "profiles"
OUTPUT = DATA / "generated" / "profiles.json"
# Name and date of birth per person, for matching elsewhere; never published.
PRIVATE = RAW / "people_private.json"
TSE_FILES = "https://cdn.tse.jus.br/estatistica/sead/odsele"
RESULTS = "https://resultados.tse.jus.br/oficial/ele2026/6259/dados"
CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
SENADO = "https://legis.senado.leg.br/dadosabertos"
YEARS = [2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024]
UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
    "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]  # fmt: skip
OFFICES = {3: "governador", 5: "senador", 6: "deputado-federal"}
# The Senate term that started in 2023 and runs to 2031: senators elected in 2022.
TERM_FROM_2022 = "57"
# Câmara legislature 2023–2027: the deputies in office now.
CAMARA_LEGISLATURE = 57
MISSING = {"", "#NULO", "#NULO#", "#NE", "-1", "-3", "-4", "NÃO DIVULGÁVEL"}
WORKERS = 6


def plain(text: str) -> str:
    """Upper case, no accents or punctuation, single spaces: for matching names."""
    ascii_ = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", ascii_).split())


LOWER = {"de", "da", "do", "das", "dos", "e", "d"}


def title(text: str) -> str:
    """'RIO DE JANEIRO' → 'Rio de Janeiro'; "SANTA BÁRBARA D'OESTE" → "Santa Bárbara d'Oeste"."""
    words = text.lower().split()
    out = []
    for i, w in enumerate(words):
        if i and w in LOWER:
            out.append(w)
        elif len(w) <= 4 and not re.search(r"[aeiouáéíóúâêôãõ]", w):
            out.append(w.upper())  # initials and acronyms: JHC, PT
        elif "'" in w:
            head, _, tail = w.partition("'")
            out.append(f"{head}'{tail.capitalize()}" if head in LOWER else w.capitalize())
        else:
            out.append(w.capitalize())
    return " ".join(out)


def value(v: str | None) -> str | None:
    v = (v or "").strip()
    return None if v in MISSING else v


def cached(name: str, url: str) -> bytes:
    path = RAW / name
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {name}…", flush=True)
        path.write_bytes(get(url))
    return path.read_bytes()


def candidate_rows(year: int, kind: str = "consulta_cand"):
    """Rows of the TSE's candidate file of a year: the national file when there is one."""
    data = cached(f"{kind}_{year}.zip", f"{TSE_FILES}/{kind}/{kind}_{year}.zip")
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in z.namelist() if n.lower().endswith(".csv")]
    national = [n for n in names if "BRASIL" in n.upper()]
    for name in national or names:
        with z.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")


def num(v: object) -> float:
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return 0.0


def retrying(url: str, tries: int = 5) -> bytes:
    """The Câmara's API times out now and then (504): wait and ask again."""
    for attempt in range(tries):
        try:
            return get(url)
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries - 1:
                raise
            time.sleep(3 * (attempt + 1))
    raise AssertionError


# --- Who was elected -------------------------------------------------------------------


def elected_2026() -> tuple[list[dict], bool]:
    """Everyone elected (or going to the runoff) in 2026, by TSE candidate sequence number;
    and whether the deputies are the TSE's word (False: our projection)."""
    out: list[dict] = []
    official_deputies = True
    for uf in UFS:
        for code, office in OFFICES.items():
            raw = json.loads(get(f"{RESULTS}/{uf.lower()}/{uf.lower()}-c{code:04d}-e006259-u.json"))
            o = raw["carg"][0]
            valid = num(raw["v"]["vv"])
            cands, lists = [], []
            for g in o["agr"]:
                votes = 0
                for p in g["par"]:
                    votes += int(num(p.get("tvtn")) + num(p.get("tvtl")))
                    for c in p["cand"]:
                        cands.append(
                            {
                                "sq": str(c.get("sqcand")),
                                "list": g["n"],
                                "votes": int(num(c.get("vap"))),
                                "status": str(c.get("st", "")),
                                "elected": str(c.get("st", "")).startswith("Eleito"),
                            }
                        )
                lists.append({"key": g["n"], "votes": votes})
            if office == "deputado-federal" and not any(c["elected"] for c in cands):
                official_deputies = False
                lists.sort(key=lambda lst: -lst["votes"])
                project_seats(lists, cands, int(num(o["nv"])), int(valid))
            for c in cands:
                runoff = c["status"] == "2º turno"
                if c["elected"] or runoff:
                    out.append(
                        {
                            "sq": c["sq"],
                            "office": office,
                            "uf": uf,
                            "votes": c["votes"],
                            "share": round(c["votes"] / valid * 100, 2) if valid else None,
                            "status": "runoff" if runoff else "elected",
                        }
                    )
    return out, official_deputies


# --- Candidacies ----------------------------------------------------------------------


OFFICE_NAMES = {
    "DEPUTADO FEDERAL": "deputado-federal",
    "DEPUTADO ESTADUAL": "deputado-estadual",
    "DEPUTADO DISTRITAL": "deputado-distrital",
    "SENADOR": "senador",
    "GOVERNADOR": "governador",
    "VICE-GOVERNADOR": "vice-governador",
    "PRESIDENTE": "presidente",
    "VICE-PRESIDENTE": "vice-presidente",
    "PREFEITO": "prefeito",
    "VICE-PREFEITO": "vice-prefeito",
    "VEREADOR": "vereador",
    "1º SUPLENTE": "suplente-senador",
    "2º SUPLENTE": "suplente-senador",
}


def result_of(row: dict) -> str:
    """'elected', 'runoff', 'substitute', 'lost' or 'unfit' (candidacy not accepted)."""
    r = (row.get("DS_SIT_TOT_TURNO") or "").upper()
    # A registration the TSE's file marks unfit: its "not elected" says nothing about the vote.
    if (row.get("DS_SITUACAO_CANDIDATURA") or "").upper() == "INAPTO":
        return "unfit"
    if r.startswith("ELEITO"):
        return "elected"
    if "2º TURNO" in r:
        return "runoff"
    if r.startswith("SUPLENTE"):
        return "substitute"
    if r == "NÃO ELEITO":
        return "lost"
    return "unfit"


def history(titles: set[str]) -> dict[str, list[dict]]:
    """Voter registration → candidacies 2010–2024 (the runoff's result where there was one)."""
    out: dict[str, dict[tuple, dict]] = defaultdict(dict)
    for year in YEARS:
        n = 0
        for row in candidate_rows(year):
            t = value(row.get("NR_TITULO_ELEITORAL_CANDIDATO"))
            if not t or t not in titles:
                continue
            office = OFFICE_NAMES.get((row.get("DS_CARGO") or "").upper())
            if not office:
                continue
            key = (year, office, row.get("SG_UE"))
            entry = {
                "year": year,
                "office": office,
                "place": title(row.get("NM_UE") or "")
                if office in ("prefeito", "vice-prefeito", "vereador")
                else row.get("SG_UF"),
                "uf": row.get("SG_UF"),
                "party": row.get("SG_PARTIDO"),
                "result": result_of(row),
            }
            # Runoff years list a candidate once per round: the 2nd round's result wins.
            if key not in out[t] or row.get("NR_TURNO") == "2":
                out[t][key] = entry
            n += 1
        print(f"  {year}: {n} candidacies of the people elected in 2026")
    return {t: sorted(v.values(), key=lambda e: e["year"]) for t, v in out.items()}


def kind_of(office: str, past: list[dict]) -> str:
    """'returning' to the same office, 'other-office' (elected before to another), 'tried'
    (ran before, never elected) or 'new' (no candidacy since 2010)."""
    won = [e for e in past if e["result"] == "elected"]
    if any(e["office"] == office for e in won):
        return "returning"
    if won:
        return "other-office"
    if past:
        return "tried"
    return "new"


# --- Contacts -------------------------------------------------------------------------


def camara_deputies() -> dict[str, dict]:
    """CPF → the Câmara's details for every deputy of the current legislature (cached)."""
    path = RAW / "camara_deputados.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    ids: list[int] = []
    page = 1
    while True:
        url = f"{CAMARA}/deputados?idLegislatura={CAMARA_LEGISLATURE}&itens=100&pagina={page}"
        data = json.loads(retrying(url))["dados"]
        ids += [d["id"] for d in data]
        if len(data) < 100:
            break
        page += 1
    print(f"  Câmara: {len(ids)} deputies in legislature {CAMARA_LEGISLATURE}", flush=True)

    def detail(i: int) -> dict | None:
        try:
            return json.loads(retrying(f"{CAMARA}/deputados/{i}"))["dados"]
        except Exception as e:  # reported, the person simply gets no contact
            print(f"    deputado {i}: {type(e).__name__}", file=sys.stderr)
            return None

    with ThreadPoolExecutor(WORKERS) as pool:
        details = [d for d in pool.map(detail, ids) if d]
    out = {d["cpf"]: d for d in details if d.get("cpf")}
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def senators() -> list[dict]:
    """Every senator in office now, with the Senate's details (cached)."""
    path = RAW / "senado_senadores.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    members = json.loads(get(f"{SENADO}/senador/lista/atual.json"))["ListaParlamentarEmExercicio"][
        "Parlamentares"
    ]["Parlamentar"]
    out = []
    for m in members:
        code = m["IdentificacaoParlamentar"]["CodigoParlamentar"]
        d = json.loads(get(f"{SENADO}/senador/{code}.json"))["DetalheParlamentar"]["Parlamentar"]
        d["Mandato"] = m["Mandato"]
        out.append(d)
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


SOCIAL = [
    ("instagram", "Instagram"),
    ("facebook", "Facebook"),
    ("twitter", "X"),
    ("x.com", "X"),
    ("youtube", "YouTube"),
    ("tiktok", "TikTok"),
    ("threads", "Threads"),
    ("linkedin", "LinkedIn"),
    ("bsky", "Bluesky"),
]


def socials(urls: list[str]) -> list[dict]:
    out = []
    for u in urls:
        u = u.strip()
        if not u:
            continue
        if not u.startswith("http"):
            u = "https://" + u
        name = next((label for key, label in SOCIAL if key in u.lower()), "Site")
        out.append({"network": name, "url": u})
    return out


def camara_contact(d: dict) -> dict:
    s = d.get("ultimoStatus") or {}
    g = s.get("gabinete") or {}
    office = ", ".join(
        x
        for x in (
            f"Anexo {g['predio']}" if g.get("predio") else "",
            f"gabinete {g['sala']}" if g.get("sala") else "",
        )
        if x
    )
    return {
        "house": "camara",
        "page": f"https://www.camara.leg.br/deputados/{d['id']}",
        "photo": s.get("urlFoto"),
        "email": g.get("email") or s.get("email"),
        "phone": f"(61) {g['telefone']}" if g.get("telefone") else None,
        "office": office or None,
        "site": d.get("urlWebsite"),
        "socials": socials(d.get("redeSocial") or []),
        "inOffice": s.get("situacao") == "Exercício",
    }


def senado_contact(d: dict) -> dict:
    ident = d["IdentificacaoParlamentar"]
    phones = (d.get("Telefones") or {}).get("Telefone") or []
    if isinstance(phones, dict):
        phones = [phones]
    return {
        "house": "senado",
        "page": ident.get("UrlPaginaParlamentar", "").replace("http://", "https://"),
        "photo": (ident.get("UrlFotoParlamentar") or "").replace("http://", "https://") or None,
        "email": ident.get("EmailParlamentar"),
        "phone": f"(61) {phones[0]['NumeroTelefone']}" if phones else None,
        "office": (d.get("DadosBasicosParlamentar") or {}).get("EnderecoParlamentar"),
        "site": None,
        "socials": [],
        "inOffice": True,
    }


# --- Build ----------------------------------------------------------------------------


def birth(row: dict) -> str | None:
    """'dd/mm/yyyy' → 'yyyy-mm-dd', to match the Câmara and the Senate."""
    d = value(row.get("DT_NASCIMENTO"))
    if not d or not re.fullmatch(r"\d\d/\d\d/\d{4}", d):
        return None
    dd, mm, yy = d.split("/")
    return f"{yy}-{mm}-{dd}"


def slug(name: str, uf: str, office: str) -> str:
    return f"{plain(name).lower().replace(' ', '-')}-{uf.lower()}-{office}"


def main() -> int:
    print("who was elected…", flush=True)
    elected, official = elected_2026()
    by_sq = {e["sq"]: e for e in elected}
    rows_2026: dict[str, dict] = {}
    for row in candidate_rows(2026):
        if row["SQ_CANDIDATO"] in by_sq:
            rows_2026[row["SQ_CANDIDATO"]] = row
    extra = {
        r["SQ_CANDIDATO"]: r
        for r in candidate_rows(2026, "consulta_cand_complementar")
        if r["SQ_CANDIDATO"] in by_sq
    }

    # Senators elected in 2022 who stay: their 2022 candidacy, matched by name and state.
    staying = [
        s
        for s in senators()
        if s["Mandato"]["PrimeiraLegislaturaDoMandato"]["NumeroLegislatura"] == TERM_FROM_2022
    ]
    rows_2022 = [
        r for r in candidate_rows(2022) if r["DS_CARGO"].upper() in ("SENADOR", "1º SUPLENTE", "2º SUPLENTE")
    ]
    staying_rows: list[tuple[dict, dict]] = []
    for s in staying:
        ident = s["IdentificacaoParlamentar"]
        full, uf = plain(ident["NomeCompletoParlamentar"]), ident["UfParlamentar"]
        row = next((r for r in rows_2022 if r["SG_UF"] == uf and plain(r["NM_CANDIDATO"]) == full), None)
        if row is None:
            print(f"  no 2022 candidacy found for senator {ident['NomeParlamentar']} ({uf})", file=sys.stderr)
            continue
        staying_rows.append((s, row))

    titles = {value(r.get("NR_TITULO_ELEITORAL_CANDIDATO")) for r in rows_2026.values()}
    titles |= {value(r.get("NR_TITULO_ELEITORAL_CANDIDATO")) for _, r in staying_rows}
    titles.discard(None)
    print("their careers…", flush=True)
    past = history(titles)  # type: ignore[arg-type]

    print("contacts…", flush=True)
    camara = camara_deputies()
    senate = senators()
    senate_by_birth = {
        (
            plain(s["IdentificacaoParlamentar"]["NomeCompletoParlamentar"]),
            s["DadosBasicosParlamentar"].get("DataNascimento"),
        ): s
        for s in senate
    }

    def contact(row: dict) -> dict | None:
        cpf = value(row.get("NR_CPF_CANDIDATO"))
        if (
            cpf
            and cpf in camara
            and (camara[cpf].get("ultimoStatus") or {}).get("idLegislatura") == CAMARA_LEGISLATURE
        ):
            return camara_contact(camara[cpf])
        s = senate_by_birth.get((plain(row.get("NM_CANDIDATO", "")), birth(row)))
        return senado_contact(s) if s else None

    def person(
        row: dict, office: str, uf: str, status: str, votes: int | None, share: float | None, more: dict
    ) -> dict:
        t = value(row.get("NR_TITULO_ELEITORAL_CANDIDATO"))
        before = [
            e
            for e in past.get(t, [])
            if e["year"] < 2026 and not (office == "senador" and status == "staying" and e["year"] == 2022)
        ]  # type: ignore[arg-type]
        place = value(more.get("NM_MUNICIPIO_NASCIMENTO"))
        birth_uf = value(row.get("SG_UF_NASCIMENTO"))
        name = title(row["NM_URNA_CANDIDATO"].strip())
        private[slug(name, uf, office)] = {"born": birth(row), "fullName": row["NM_CANDIDATO"].strip()}
        return {
            "id": slug(name, uf, office),
            "name": name,
            "fullName": title(row["NM_CANDIDATO"].strip()),
            "office": office,
            "uf": uf,
            "party": row["SG_PARTIDO"],
            "number": row["NR_CANDIDATO"],
            "status": status,
            "votes": votes,
            "share": share,
            "age": int(more["NR_IDADE_DATA_POSSE"]) if value(more.get("NR_IDADE_DATA_POSSE")) else None,
            "birthplace": f"{title(place)} ({birth_uf})" if place and birth_uf else birth_uf,
            "education": (value(row.get("DS_GRAU_INSTRUCAO")) or "").capitalize() or None,
            "occupation": (value(row.get("DS_OCUPACAO")) or "").capitalize() or None,
            "kind": kind_of(office, before),
            "history": before,
            "contact": contact(row),
        }

    # Kept out of the site and out of git: what pipeline.profiles_web needs to find each
    # person elsewhere (Wikidata matches by name and date of birth).
    private: dict[str, dict] = {}
    people = []
    for sq, e in by_sq.items():
        row = rows_2026.get(sq)
        if not row:
            print(f"  candidate {sq} missing from the 2026 file", file=sys.stderr)
            continue
        status = e["status"] if e["office"] != "deputado-federal" or official else "projected"
        people.append(person(row, e["office"], e["uf"], status, e["votes"], e["share"], extra.get(sq, {})))
    for s, row in staying_rows:
        p = person(row, "senador", s["IdentificacaoParlamentar"]["UfParlamentar"], "staying", None, None, {})
        p["contact"] = senado_contact(s)
        p["party"] = s["IdentificacaoParlamentar"].get("SiglaPartidoParlamentar") or p["party"]
        people.append(p)

    people.sort(key=lambda p: (p["office"], p["uf"], -(p["votes"] or 0)))
    out = {"officialDeputies": official, "historySince": YEARS[0], "people": people}
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    PRIVATE.write_text(json.dumps(private, ensure_ascii=False), encoding="utf-8")
    counts = defaultdict(int)
    for p in people:
        counts[(p["office"], p["kind"])] += 1
    for k, n in sorted(counts.items()):
        print(f"  {k[0]:17s} {k[1]:13s} {n}")
    with_contact = sum(1 for p in people if p["contact"])
    print(f"  {len(people)} people, {with_contact} with a contact")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
