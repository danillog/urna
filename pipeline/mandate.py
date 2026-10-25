"""Builds data/generated/mandate.json: what the elected who sit in Congress now did in this term.

    uv run python -m pipeline.mandate

For every person in profiles.json who is a deputy or a senator now (since February 2023).

Chamber, from the Câmara's open data (bulk files, cached in data/raw/camara/, not in git):

- Votes: in how many of the plenary's roll-call votes they voted, counted from their first
  vote in the term (a deputy who took the seat later is not counted absent before that).
  "Present in roll-call votes" is what this is; there is no record of hours or days worked.
- With the government: in contested votes (some party asked the opposite of the
  government's leader), how often their vote matched the government's orientation.
  Same method as pipeline.governismo, here per deputy; obstruction counts as "no".
- Bills: bills (PL, PLP, PEC) they presented as first author, how many the Chamber passed,
  and how many became law.
- Parliamentary allowance (cota, CEAP): what was reimbursed, by category, against the
  median of the deputies of the same state (the allowance differs by state). Per month in
  which they spent anything, so a shorter stay does not look thrifty.

Files: votacoes, votacoesOrientacoes, votacoesVotos, proposicoes, proposicoesAutores
(dadosabertos.camara.leg.br/arquivos) and Ano-<year>.csv.zip (camara.leg.br/cotas). The
allowance file carries other people's identifiers (CPF, supplier numbers): only the deputy's
id, the category and the amount are read.

Senate, from its open data API (legis.senado.leg.br/dadosabertos, cached in data/raw/senado/)
and its transparency site:

- Votes: each roll call lists every senator in office, so the count is exact: voted (yes,
  no, abstention, secret ballot, presiding), absent on leave or on a mission (justified),
  or absent.
- With the government: the leaders' orientations of each roll call, as in the Chamber.
- Bills: PL, PLP and PEC presented since February 2023 with the senator as first author.
- Allowance (CEAPS): yearly files, which name the senator instead of a code; matched by name.
"""

from __future__ import annotations

import bisect
import calendar
import collections
import csv
import http.client
import io
import json
import re
import statistics
import sys
import time
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from .build import DATA
from .governismo import GOVERNMENT, side

RAW = DATA / "raw" / "camara"
PROFILES = DATA / "generated" / "profiles.json"
OUTPUT = DATA / "generated" / "mandate.json"
FILES = "https://dadosabertos.camara.leg.br/arquivos/{kind}/csv/{kind}-{year}.csv"
COTA = "https://www.camara.leg.br/cotas/Ano-{year}.csv.zip"
LEGISLATURE = 57
START = date(2023, 2, 1)
BILLS = {"PL", "PLP", "PEC"}
LAW = "Transformado em Norma Jurídica"
# Situations of a bill the Chamber has passed (sent on to the Senate or to sanction).
PASSED = re.compile(r"Senado Federal|Sanção|Promulga|Transformado em Norma", re.I)
CAMARA_PAGE = re.compile(r"camara\.leg\.br/deputados/(\d+)")
TOP_CATEGORIES = 5


def cached(name: str, url: str) -> Path:
    path = RAW / name
    if not path.exists() or path.stat().st_size == 0:
        RAW.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {name}…", flush=True)
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    return path


def rows(path: Path, member: str | None = None):
    if member:
        with zipfile.ZipFile(path) as z, z.open(member) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"), delimiter=";")
        return
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def years() -> range:
    return range(START.year, date.today().year + 1)


# --- Votes -----------------------------------------------------------------------------


def plenary_votes() -> tuple[dict[str, str], dict[str, str | None], set[str]]:
    """Roll calls in the plenary this term: id → day; id → the government's side; and the
    contested ones (some bancada asked the opposite of the government)."""
    days: dict[str, str] = {}
    gov: dict[str, str | None] = {}
    contested: set[str] = set()
    for y in years():
        for r in rows(cached(f"votacoes-{y}.csv", FILES.format(kind="votacoes", year=y))):
            if r["siglaOrgao"] == "PLEN" and r["data"] >= START.isoformat():
                days[r["id"]] = r["data"]
        others: dict[str, list[str | None]] = defaultdict(list)
        kind = "votacoesOrientacoes"
        orientations = cached(f"{kind}-{y}.csv", FILES.format(kind=kind, year=y))
        for r in rows(orientations):
            vote = r["idVotacao"]
            if vote not in days:
                continue
            bancada = r["siglaBancada"].strip().upper().rstrip(".")
            o = side(r["orientacao"])
            if bancada in {g.rstrip(".") for g in GOVERNMENT}:
                gov[vote] = o
            else:  # parties, blocs and "Oposição"/"Minoria" alike count for the contest
                others[vote].append(o)
        for vote, os_ in others.items():
            g = gov.get(vote)
            if g and any(o and o != g for o in os_):
                contested.add(vote)
    return days, gov, contested


def deputy_votes(days: dict[str, str], gov: dict[str, str | None], contested: set[str]) -> dict[str, dict]:
    """Deputy id → roll calls voted, the first one's day, and the vote with the government."""
    voted: dict[str, set[str]] = defaultdict(set)
    first: dict[str, str] = {}
    with_gov: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for y in years():
        for r in rows(cached(f"votacoesVotos-{y}.csv", FILES.format(kind="votacoesVotos", year=y))):
            vote, dep = r["idVotacao"], r["deputado_id"]
            if vote not in days or not dep or not r["voto"]:
                continue
            voted[dep].add(vote)
            if dep not in first or days[vote] < first[dep]:
                first[dep] = days[vote]
            mine = side(r["voto"])
            if vote in contested and mine:
                with_gov[dep][1] += 1
                with_gov[dep][0] += mine == gov[vote]
    # Roll calls: votes with individual records (the plenary also votes by acclamation).
    roll_calls = sorted(days[v] for v in set().union(*voted.values())) if voted else []
    out = {}
    for dep, votes in voted.items():
        held = len(roll_calls) - bisect.bisect_left(roll_calls, first[dep])
        w, n = with_gov[dep]
        out[dep] = {
            "votes": {"cast": len(votes), "held": held, "from": first[dep]},
            "government": {"with": w, "of": n} if n else None,
        }
    return out


# --- Bills -----------------------------------------------------------------------------


def bills() -> dict[str, dict]:
    """Deputy id → bills as first author this term, passed by the Chamber, became law."""
    status: dict[str, str] = {}
    for y in years():
        for r in rows(cached(f"proposicoes-{y}.csv", FILES.format(kind="proposicoes", year=y))):
            if r["siglaTipo"] in BILLS and r["dataApresentacao"][:10] >= START.isoformat():
                status[r["id"]] = r["ultimoStatus_descricaoSituacao"]
    out: dict[str, dict] = defaultdict(lambda: {"first": 0, "passed": 0, "law": 0})
    seen: set[tuple[str, str]] = set()  # a bill can be listed in more than one year's file
    for y in years():
        for r in rows(cached(f"proposicoesAutores-{y}.csv", FILES.format(kind="proposicoesAutores", year=y))):
            pid, dep = r["idProposicao"], r["idDeputadoAutor"]
            if pid not in status or not dep or r["ordemAssinatura"] != "1" or (pid, dep) in seen:
                continue
            seen.add((pid, dep))
            s = status[pid]
            out[dep]["first"] += 1
            out[dep]["passed"] += bool(PASSED.search(s))
            out[dep]["law"] += s == LAW
    return dict(out)


# --- Allowance -------------------------------------------------------------------------


def allowance() -> tuple[dict[str, dict], dict[str, str]]:
    """Deputy id → total, months with spending and top categories; and deputy id → state."""
    total: dict[str, float] = defaultdict(float)
    months: dict[str, set[str]] = defaultdict(set)
    by_cat: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    uf: dict[str, str] = {}
    for y in years():
        path = cached(f"cota-{y}.csv.zip", COTA.format(year=y))
        member = f"Ano-{y}.csv"
        for r in rows(path, member):
            dep = r["ideCadastro"].strip()
            if not dep or r["codLegislatura"] != str(LEGISLATURE):
                continue
            try:
                value = float(r["vlrLiquido"].replace(",", "."))
            except ValueError:
                continue
            total[dep] += value
            months[dep].add(f"{r['numAno']}-{int(r['numMes']):02d}")
            by_cat[dep][r["txtDescricao"].strip().capitalize()] += value
            uf[dep] = r["sgUF"]
    out = {}
    for dep, t in total.items():
        n = len(months[dep])
        cats = sorted(by_cat[dep].items(), key=lambda kv: -kv[1])
        out[dep] = {
            "total": round(t),
            "months": n,
            "perMonth": round(t / n) if n else 0,
            "categories": [{"name": k, "value": round(v)} for k, v in cats[:TOP_CATEGORIES]],
        }
    return out, uf


def state_medians(spending: dict[str, dict], uf: dict[str, str]) -> dict[str, int]:
    per_uf: dict[str, list[int]] = defaultdict(list)
    for dep, s in spending.items():
        if s["months"] >= 3:  # a few weeks in the seat says little
            per_uf[uf[dep]].append(s["perMonth"])
    return {u: round(statistics.median(v)) for u, v in per_uf.items() if v}


# --- Senate ----------------------------------------------------------------------------

SENADO = "https://legis.senado.leg.br/dadosabertos"
SENADO_RAW = DATA / "raw" / "senado"
CEAPS = "https://www.senado.leg.br/transparencia/LAI/verba/despesa_ceaps_{year}.csv"
SENADO_PAGE = re.compile(r"senado\.leg\.br/.*perfil/(\d+)")
VOTED = {"Sim", "Não", "Abstenção", "Votou", "Presidente (art. 51 RISF)", "Obstrução"}
JUSTIFIED = {"AP", "LS", "LP", "LAP", "LC", "LG", "MIS", "MERC", "REP"}
SEN_LAW = re.compile(r"TRANSFORMADA EM NORMA", re.I)
SEN_PASSED = re.compile(r"TRANSFORMADA EM NORMA|REMETIDA À CÂMARA|SANÇÃO|PROMULGA", re.I)


def download(url: str, accept: str = "*/*") -> bytes:
    """With a few retries: the Senate's servers drop long answers now and then."""
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "urna/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except (OSError, http.client.HTTPException):
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    raise AssertionError


def senado_json(name: str, url: str, refresh: bool = False):
    path = SENADO_RAW / name
    if refresh or not path.exists():
        SENADO_RAW.mkdir(parents=True, exist_ok=True)
        path.write_bytes(download(url, "application/json"))
    return json.loads(path.read_text(encoding="utf-8"))


def months():
    today = date.today()
    y, m = START.year, START.month
    while (y, m) <= (today.year, today.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def senate_votes() -> tuple[dict[str, dict], dict[str, str]]:
    """Senator code → roll calls voted, absences justified and not, and the vote with the
    government in contested votes; and code → name."""
    today = date.today()
    tally: dict[str, collections.Counter] = defaultdict(collections.Counter)
    names: dict[str, str] = {}
    for y, m in months():
        last = calendar.monthrange(y, m)[1]
        current = (y, m) == (today.year, today.month)
        votes = senado_json(
            f"votacoes-{y}-{m:02d}.json",
            f"{SENADO}/votacao?dataInicio={y}-{m:02d}-01&dataFim={y}-{m:02d}-{last}",
            refresh=current,
        )
        orientations = senado_json(
            f"orientacoes-{y}-{m:02d}.json",
            f"{SENADO}/plenario/votacao/orientacaoBancada/{y}{m:02d}01/{y}{m:02d}{last}",
            refresh=current,
        )
        gov: dict[int, str | None] = {}
        contested: set[int] = set()
        for v in (orientations or {}).get("votacoes") or []:
            seq = v.get("sequencialVotacao")
            sides = {o["partido"]: side(o.get("voto") or "") for o in v.get("orientacoesLideranca") or []}
            g = sides.pop("Governo", None)
            gov[seq] = g
            if g and any(o and o != g for o in sides.values()):
                contested.add(seq)
        for v in votes or []:
            secret = v.get("votacaoSecreta") == "S"  # no individual vote to compare
            seq = v.get("sequencialVotacao")
            for x in v.get("votos") or []:
                code = str(x["codigoParlamentar"])
                names[code] = x["nomeParlamentar"]
                vote = x["siglaVotoParlamentar"]
                t = tally[code]
                t["held"] += 1
                if vote in VOTED:
                    t["cast"] += 1
                elif vote in JUSTIFIED:
                    t["justified"] += 1
                if not secret and seq in contested:
                    mine = side(vote)
                    if mine:
                        t["of"] += 1
                        t["with"] += mine == gov[seq]
    out = {}
    for code, t in tally.items():
        out[code] = {
            "votes": {"cast": t["cast"], "held": t["held"], "justified": t["justified"]},
            "government": {"with": t["with"], "of": t["of"]} if t["of"] else None,
        }
    return out, names


def senate_bills(code: str, name: str) -> dict:
    found = senado_json(
        f"autorias-{code}.json",
        f"{SENADO}/processo?codigoParlamentarAutor={code}&dataInicioApresentacao={START.isoformat()}",
    )
    out = {"first": 0, "passed": 0, "law": 0}
    me = plain_name(name)
    for p in found or []:
        if p.get("identificacao", "").split(" ")[0] not in BILLS:
            continue
        first = re.sub(r"^Senador[a]? ", "", (p.get("autoria") or "").split(",")[0]).split(" (")[0]
        if plain_name(first) != me:
            continue
        status = p.get("situacaoAtual") or ""
        out["first"] += 1
        out["passed"] += bool(SEN_PASSED.search(status))
        out["law"] += bool(SEN_LAW.search(status))
    return out


def plain_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z ]", " ", text).split())


def senate_allowance() -> dict[str, dict]:
    """Plain name → total, months and top categories, from the CEAPS files."""
    total: dict[str, float] = defaultdict(float)
    months_: dict[str, set[str]] = defaultdict(set)
    by_cat: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for y in years():
        path = SENADO_RAW / f"ceaps-{y}.csv"
        if not path.exists() or y == date.today().year:
            SENADO_RAW.mkdir(parents=True, exist_ok=True)
            path.write_bytes(download(CEAPS.format(year=y)))
        lines = path.read_text(encoding="latin-1").splitlines()[1:]  # first line: update time
        for r in csv.DictReader(lines, delimiter=";"):
            month = f"{r['ANO']}-{int(r['MES']):02d}"
            if month < START.isoformat()[:7]:
                continue
            try:
                value = float(r["VALOR_REEMBOLSADO"].replace(".", "").replace(",", "."))
            except ValueError:
                continue
            who = plain_name(r["SENADOR"])
            total[who] += value
            months_[who].add(month)
            by_cat[who][r["TIPO_DESPESA"].split(",")[0].strip().rstrip(".").capitalize()] += value
    out = {}
    for who, t in total.items():
        n = len(months_[who])
        cats = sorted(by_cat[who].items(), key=lambda kv: -kv[1])
        out[who] = {
            "total": round(t),
            "months": n,
            "perMonth": round(t / n) if n else 0,
            "categories": [{"name": k, "value": round(v)} for k, v in cats[:TOP_CATEGORIES]],
        }
    return out


def senator_codes(profiles: dict) -> dict[str, str]:
    out = {}
    for p in profiles["people"]:
        m = SENADO_PAGE.search((p.get("contact") or {}).get("page") or "")
        if m:
            out[p["id"]] = m[1]
    return out


# --- Committees, rapporteurships and speeches ----------------------------------------------

CAMARA_API = "https://dadosabertos.camara.leg.br/api/v2"
MEMBER_ROLES = {"Titular", "Suplente"}
RAPPORTEUR_TYPES = ("PL", "PLP", "PEC", "MPV", "PDL")


def chamber_committees() -> dict[str, list[dict]]:
    """Deputy id → committees they sit on now, with the role (the bulk file of the term)."""
    path = cached(
        "orgaosDeputados-L57.csv",
        "https://dadosabertos.camara.leg.br/arquivos/orgaosDeputados/csv/orgaosDeputados-L57.csv",
    )
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows(path):
        if r["dataFim"] or (r["nomeOrgao"] or "").startswith(("Frente Parlamentar", "Grupo Parlamentar")):
            continue
        dep = r["uriDeputado"].rstrip("/").split("/")[-1]
        out[dep].append({"name": r["nomePublicacaoOrgao"] or r["nomeOrgao"], "role": r["cargo"]})
    return out


def chamber_rapporteurs() -> dict[str, int]:
    """Deputy id → bills presented this term that have them as rapporteur now."""
    out: dict[str, int] = defaultdict(int)
    for y in years():
        for r in rows(cached(f"proposicoes-{y}.csv", FILES.format(kind="proposicoes", year=y))):
            uri = r.get("ultimoStatus_uriRelator") or ""
            if uri and r["siglaTipo"] in RAPPORTEUR_TYPES and r["dataApresentacao"][:10] >= START.isoformat():
                out[uri.rstrip("/").split("/")[-1]] += 1
    return out


def chamber_speeches(dep: str) -> int | None:
    """Speeches in the plenary and committees since February 2023 (the Câmara's API, cached);
    None when the API keeps failing (it answers 500 now and then): tried again next run."""
    try:
        return _chamber_speeches(dep)
    except (OSError, http.client.HTTPException, ValueError, KeyError) as e:
        print(f"  speeches of deputy {dep}: {type(e).__name__}", file=sys.stderr)
        return None


def _chamber_speeches(dep: str) -> int:
    path = RAW / "discursos" / f"{dep}.json"
    if not path.exists() or date.fromtimestamp(path.stat().st_mtime) < date.today().replace(day=1):
        items: list[dict] = []
        page = 1
        while True:
            url = (f"{CAMARA_API}/deputados/{dep}/discursos?dataInicio={START.isoformat()}"
                   f"&itens=100&pagina={page}&ordem=ASC&ordenarPor=dataHoraInicio")  # fmt: skip
            data = json.loads(download(url, "application/json"))
            items += data["dados"]
            if not any(link["rel"] == "next" for link in data.get("links", [])):
                break
            page += 1
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([d.get("dataHoraInicio") for d in items]), encoding="utf-8")
    return len(json.loads(path.read_text(encoding="utf-8")))


def as_list(x) -> list:
    return x if isinstance(x, list) else [x] if x else []


def stale(name: str) -> bool:
    """A cached Senate file to read again: missing, or not read since this month began."""
    path = SENADO_RAW / name
    return not path.exists() or date.fromtimestamp(path.stat().st_mtime) < date.today().replace(day=1)


def senate_list(data: dict, top: str, group: str, item: str) -> list:
    member = ((data or {}).get(top) or {}).get("Parlamentar") or {}
    return as_list((member.get(group) or {}).get(item))  # a group with nothing in it comes as null


def senate_activity(code: str) -> dict:
    """A senator's committees now, matters they were made rapporteur of since February 2023,
    and their speeches since then (the Senate's API, cached; speeches asked year by year)."""
    since = START.isoformat()
    name = f"comissoes-{code}.json"
    com = senado_json(name, f"{SENADO}/senador/{code}/comissoes.json", stale(name))
    committees = [
        {"name": c["IdentificacaoComissao"]["NomeComissao"], "role": c.get("DescricaoParticipacao", "")}
        for c in senate_list(com, "MembroComissaoParlamentar", "MembroComissoes", "Comissao")
        if not c.get("DataFim")
        and c["IdentificacaoComissao"].get("SiglaCasaComissao") in ("SF", "CN")
        and not c["IdentificacaoComissao"]["NomeComissao"].startswith(
            ("Grupo Parlamentar", "Frente Parlamentar")
        )
    ]
    name = f"relatorias-{code}.json"
    rel = senado_json(name, f"{SENADO}/senador/{code}/relatorias.json", stale(name))
    reports = senate_list(rel, "MateriasRelatoriaParlamentar", "Relatorias", "Relatoria")
    rapporteur = len({r["Materia"]["Codigo"] for r in reports if (r.get("DataDesignacao") or "") >= since})
    speeches = 0
    for y in years():
        end = f"{y}1231" if y < date.today().year else date.today().strftime("%Y%m%d")
        name = f"discursos-{code}-{y}.json"
        url = f"{SENADO}/senador/{code}/discursos.json?dataInicio={y}0101&dataFim={end}"
        # Past years do not change; this year's is read again monthly.
        d = senado_json(name, url, stale(name) and y == date.today().year)
        found = senate_list(d, "DiscursosParlamentar", "Pronunciamentos", "Pronunciamento")
        speeches += sum(1 for x in found if (x.get("DataPronunciamento") or "") >= since)
    return {"committees": committees, "rapporteur": rapporteur, "speeches": speeches}


# --- Key votes: constitutional amendments and complementary laws -------------------------

# Which votes count is not ours to pick: every plenary roll call this term on a proposed
# constitutional amendment (PEC) or a complementary law (PLP), the two that need more than
# a simple majority (3/5 and an absolute majority).
KEY_TYPES = ("PEC", "PLP")
LETTER = {"Sim": "S", "Não": "N", "Obstrução": "O", "Abstenção": "A", "Votou": "V"}


def chamber_key_votes(days: dict[str, str], gov: dict[str, str | None]) -> dict:
    """The roll calls and each deputy's vote in them, one letter per roll call."""
    bills: dict[str, dict] = {}
    for y in years():
        name = f"votacoesProposicoes-{y}.csv"
        for r in rows(cached(name, FILES.format(kind="votacoesProposicoes", year=y))):
            if (
                r["idVotacao"] in days
                and r["proposicao_siglaTipo"] in KEY_TYPES
                and r["idVotacao"] not in bills
            ):
                bills[r["idVotacao"]] = {
                    "bill": r["proposicao_titulo"],
                    "summary": r["proposicao_ementa"][:300],
                    "what": r["descricao"][:200],
                }
    voted: dict[str, dict[str, str]] = defaultdict(dict)
    for y in years():
        for r in rows(cached(f"votacoesVotos-{y}.csv", FILES.format(kind="votacoesVotos", year=y))):
            if r["idVotacao"] in bills and r["deputado_id"]:
                voted[r["idVotacao"]][r["deputado_id"]] = LETTER.get(r["voto"], "-")
    order = sorted((v for v in bills if voted.get(v)), key=lambda v: (days[v], v))
    members = {d for v in order for d in voted[v]}
    return {
        "rolls": [{"date": days[v], **bills[v], "government": gov.get(v)} for v in order],
        "votes": {d: "".join(voted[v].get(d, "-") for v in order) for d in sorted(members)},
    }


def senate_key_votes() -> dict:
    rolls: list[dict] = []
    voted: list[dict[str, str]] = []
    for y, m in months():
        votes = senado_json(f"votacoes-{y}-{m:02d}.json", "")
        orientations = senado_json(f"orientacoes-{y}-{m:02d}.json", "") or {}
        gov = {
            v.get("sequencialVotacao"): next(
                (
                    side(o.get("voto") or "")
                    for o in v.get("orientacoesLideranca") or []
                    if o["partido"] == "Governo"
                ),
                None,
            )
            for v in orientations.get("votacoes") or []
        }
        for v in votes or []:
            if v.get("sigla") not in KEY_TYPES or str(v.get("dataSessao", "")) < START.isoformat():
                continue
            rolls.append(
                {
                    "date": v["dataSessao"],
                    "bill": v.get("identificacao", ""),
                    "summary": (v.get("ementa") or "")[:300],
                    "what": (v.get("descricaoVotacao") or "")[:200],
                    "government": gov.get(v.get("sequencialVotacao")),
                }
            )
            voted.append({str(x["codigoParlamentar"]): LETTER.get(x["siglaVotoParlamentar"], "-")
                          for x in v.get("votos") or []})  # fmt: skip
    members = {s for v in voted for s in v}
    return {"rolls": rolls, "votes": {s: "".join(v.get(s, "-") for v in voted) for s in sorted(members)}}


# --- Build -----------------------------------------------------------------------------


def deputy_ids(profiles: dict) -> dict[str, str]:
    """Profile id → Câmara deputy id, for the elected who sit in the Chamber now."""
    out = {}
    for p in profiles["people"]:
        page = (p.get("contact") or {}).get("page") or ""
        m = CAMARA_PAGE.search(page)
        if m:
            out[p["id"]] = m[1]
    return out


def main() -> int:
    profiles = json.loads(PROFILES.read_text(encoding="utf-8"))
    ids = deputy_ids(profiles)
    print(f"{len(ids)} of the elected sit in the Chamber now", flush=True)
    print("votes…", flush=True)
    days, gov, contested = plenary_votes()
    votes = deputy_votes(days, gov, contested)
    print(f"  {len(contested)} contested roll calls with the government's orientation", flush=True)
    print("bills…", flush=True)
    authored = bills()
    print("key votes…", flush=True)
    key_chamber = chamber_key_votes(days, gov)
    print("allowance…", flush=True)
    spending, uf = allowance()
    medians = state_medians(spending, uf)
    print("senate…", flush=True)
    sen_ids = senator_codes(profiles)
    sen_votes, sen_names = senate_votes()
    sen_spending = senate_allowance()
    sen_medians: dict[str, list[int]] = defaultdict(list)
    people = {}
    uf_of = {p["id"]: p["uf"] for p in profiles["people"]}
    for pid, code in sen_ids.items():
        name = sen_names.get(code, "")
        entry = {"house": "senado", "id": code, **sen_votes.get(code, {"votes": None, "government": None})}
        entry["bills"] = senate_bills(code, name) if name else {"first": 0, "passed": 0, "law": 0}
        entry["allowance"] = sen_spending.get(plain_name(name)) if name else None
        entry["activity"] = senate_activity(code)
        people[pid] = entry
    for s in sen_spending.values():
        if s["months"] >= 3:
            sen_medians["all"].append(s["perMonth"])
    print(f"  {len(sen_ids)} senators, {sum(1 for p in people.values() if p['allowance'])} with CEAPS")
    print("committees, rapporteurships, speeches…", flush=True)
    committees = chamber_committees()
    rapporteurs = chamber_rapporteurs()
    with ThreadPoolExecutor(8) as pool:
        speeches = dict(zip(ids.values(), pool.map(chamber_speeches, ids.values()), strict=True))
    for pid, dep in ids.items():
        entry = {"house": "camara", "id": dep, **votes.get(dep, {"votes": None, "government": None})}
        entry["bills"] = authored.get(dep, {"first": 0, "passed": 0, "law": 0})
        entry["allowance"] = spending.get(dep)
        entry["activity"] = {
            "committees": committees.get(dep, []),
            "rapporteur": rapporteurs.get(dep, 0),
            "speeches": speeches[dep],
        }
        people[pid] = entry
    last = max(days.values()) if days else None
    out = {
        "since": START.isoformat(),
        "until": last,
        "allowanceMedianByState": medians,
        "keyVotes": {"chamber": key_chamber, "senate": senate_key_votes()},
        # Senators' allowance differs by state too, but 3 per state make no median: the house's.
        "senateAllowanceMedian": round(statistics.median(sen_medians["all"])) if sen_medians["all"] else None,
        "uf": {pid: uf_of[pid] for pid in people},
        "people": people,
    }
    # Only the votes of those with a profile: the rest are not shown anywhere.
    shown = {
        house: {e["id"] for e in people.values() if e["house"] == h}
        for house, h in (("chamber", "camara"), ("senate", "senado"))
    }
    for house, kv in out["keyVotes"].items():
        kv["votes"] = {k: v for k, v in kv["votes"].items() if k in shown[house]}
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with_votes = sum(1 for p in people.values() if p["votes"])
    print(f"wrote {OUTPUT.relative_to(DATA.parent)}: {len(people)} people, {with_votes} with votes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
