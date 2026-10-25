"""Builds data/generated/watch.json: who spends the most and who shows up, in four houses.

    uv run python -m pipeline.watch

For everyone in office today in the Câmara dos Deputados, the Senado, São Paulo's state
assembly (Alesp) and São Paulo's city council (Câmara Municipal), since their term began:

- Spending: the office allowance they were reimbursed (CEAP, CEAPS, the Alesp's verba de
  gabinete, the council's auxílio-encargos), per month in office. In Congress the ceiling
  differs by state (air fares to Brasília), so it is also given as a share of their own
  state's ceiling: Ato da Mesa 270/2023 (Câmara) and the Senate's table, both checked on the
  houses' sites on 06/10/2026. In the Alesp and the council every member has the same ceiling.
- Presence, counted only while in office (leaves, such as a minister's, are not absences):
  - Câmara: the plenary's deliberative sessions they were registered present at, over those
    held while in office (the Câmara's record of each deputy's status changes); the roll
    calls they voted in are given too, apart (the Speaker presides and seldom votes).
  - Senado: plenary roll calls they voted in, over those held while in office, leaving out
    the absences the Senate records as justified (leave, mission, parliamentary activity).
  - Câmara Municipal: plenary sessions (ordinary and extraordinary) they were marked present.
  - Alesp: it publishes no plenary attendance; what it publishes is presence at the meetings
    of the standing committees, so that is what is measured: meetings attended, over the
    meetings of the committees where they were a full member, while they were.
- Nobody with fewer than three months in office is ranked: too short to compare.

What is not measured, on purpose: "work" (there is no record of it); presence is not work.

Sources, cached in data/raw/ (not in git): the Câmara's bulk files and API, the Senate's API
and CEAPS files (pipeline.mandate), the Alesp's open data (al.sp.gov.br/dados-abertos), the
council's SPLegis presence files and SisGV allowance service.
"""

from __future__ import annotations

import contextlib
import csv
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

from .build import DATA
from .mandate import (
    CEAPS,
    FILES,
    SENADO_RAW,
    cached,
    download,
    months,
    rows,
    senado_json,
)

OUTPUT = DATA / "generated" / "watch.json"
CAMARA_RAW = DATA / "raw" / "camara"
ALESP_RAW = DATA / "raw" / "alesp"
CMSP_RAW = DATA / "raw" / "cmsp"
CAMARA_API = "https://dadosabertos.camara.leg.br/api/v2"
SENATE_LIST = "https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json"
SENATE_PAGE = "https://www25.senado.leg.br/web/senadores/senador/-/perfil/"
ALESP_FILES = "https://www.al.sp.gov.br/repositorioDados/"
CMSP_PRESENCE = "https://splegispdarmazenamento.blob.core.windows.net/containersip/"
CMSP_ALLOWANCE = "https://sisgvconsulta.saopaulo.sp.leg.br/ws/Servicos.asmx/ObterDebitoVereadorJSON"
MIN_MONTHS = 6
# Fewer chances than this to be present say too little to rank.
MIN_HELD = 20
TODAY = date.today()

# Monthly ceilings by state. Câmara: Ato da Mesa 270/2023, in force since 01/02/2023
# (camara.leg.br, Ato da Mesa 43/2009 as updated). Senado: the CEAPS table published at
# senado.leg.br/transparencia (CotaExercicioAtivParlamSenadores.pdf).
CAP_CAMARA = {
    "AC": 50426.26, "AL": 46737.90, "AM": 49363.92, "AP": 49168.58, "BA": 44804.65, "CE": 48245.57,
    "DF": 36582.46, "ES": 43217.71, "GO": 41300.86, "MA": 47945.49, "MG": 41886.51, "MS": 46336.64,
    "MT": 45221.83, "PA": 48021.25, "PB": 47826.36, "PE": 47470.60, "PI": 46765.57, "PR": 44665.66,
    "RJ": 41553.77, "RN": 48525.79, "RO": 49466.29, "RR": 51406.33, "RS": 46669.70, "SC": 45671.58,
    "SE": 45933.06, "SP": 42837.33, "TO": 45297.41,
}  # fmt: skip
CAP_SENADO = {
    "AC": 38854.45, "AL": 35056.20, "AP": 42855.20, "AM": 44276.60, "BA": 35416.20, "CE": 38186.60,
    "DF": 21045.20, "ES": 33176.60, "GO": 21045.20, "MA": 37396.60, "MT": 34934.45, "MS": 32905.20,
    "MG": 28496.20, "PA": 40426.20, "PB": 35555.20, "PR": 32586.60, "PE": 36266.60, "PI": 38834.45,
    "RJ": 31816.20, "RN": 35976.20, "RS": 35886.60, "RO": 34615.20, "RR": 40724.45, "SC": 32871.32,
    "SP": 30226.20, "SE": 41844.45, "TO": 25215.20,
}  # fmt: skip


def plain(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z ]", " ", text).split())


def month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def months_between(start: date, end: date) -> set[str]:
    out = set()
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.add(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def member(
    name: str, party: str, uf: str | None, url: str, spend: dict | None, presence: dict | None
) -> dict:
    return {"name": name, "party": party, "uf": uf, "url": url, "spend": spend, "presence": presence}


def spend_fields(total: float, months_in: int, cap: float | None) -> dict | None:
    if months_in < MIN_MONTHS:
        return None
    per = total / months_in
    out = {"total": round(total), "months": months_in, "perMonth": round(per)}
    if cap:
        out["capPct"] = round(per / cap * 100, 1)
    return out


def presence_fields(attended: int, held: int, label: str) -> dict | None:
    if held < MIN_HELD:
        return None
    return {"attended": attended, "held": held, "pct": round(attended / held * 100, 1), "of": label}


# --- Câmara dos Deputados -------------------------------------------------------------------

CAMARA_START = date(2023, 2, 1)


def camara_members() -> list[dict]:
    """Deputies in office now: the API's list without a legislature is those in exercise."""
    out, page = [], 1
    while True:
        url = f"{CAMARA_API}/deputados?itens=100&pagina={page}"
        data = json.loads(download(url, "application/json"))
        out += data["dados"]
        if not any(link["rel"] == "next" for link in data.get("links", [])):
            return out
        page += 1


def in_office(dep: int) -> list[tuple[date, date]]:
    """The periods this term a deputy was in office, from the Câmara's status changes."""
    path = CAMARA_RAW / "historico" / f"{dep}.json"
    if not path.exists() or date.fromtimestamp(path.stat().st_mtime) < TODAY:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(download(f"{CAMARA_API}/deputados/{dep}/historico", "application/json"))
    # Some records filed under this term are older (a 2022 party change): this term only.
    events = sorted(
        (
            e
            for e in json.loads(path.read_text(encoding="utf-8"))["dados"]
            if e.get("idLegislatura") == 57 and e["dataHora"][:10] >= CAMARA_START.isoformat()
        ),
        key=lambda e: e["dataHora"],
    )
    out: list[tuple[date, date]] = []
    start: date | None = None
    for e in events:
        when = datetime.fromisoformat(e["dataHora"]).date()
        if e.get("situacao") == "Exercício" and start is None:
            start = when
        elif e.get("situacao") not in (None, "Exercício") and start is not None:
            out.append((start, when))
            start = None
    if start is not None:
        out.append((start, TODAY))
    return out


def camara() -> list[dict]:
    deps = camara_members()
    with ThreadPoolExecutor(8) as pool:
        periods = dict(
            zip((d["id"] for d in deps), pool.map(in_office, (d["id"] for d in deps)), strict=True)
        )
    # Roll calls in the plenary (with individual votes) and who voted in each.
    plenary: dict[str, date] = {}
    voted: dict[int, set[str]] = defaultdict(set)
    for y in range(CAMARA_START.year, TODAY.year + 1):
        for r in rows(cached(f"votacoes-{y}.csv", FILES.format(kind="votacoes", year=y))):
            if r["siglaOrgao"] == "PLEN" and r["data"] >= CAMARA_START.isoformat():
                plenary[r["id"]] = date.fromisoformat(r["data"])
        for r in rows(cached(f"votacoesVotos-{y}.csv", FILES.format(kind="votacoesVotos", year=y))):
            if r["idVotacao"] in plenary and r["deputado_id"] and r["voto"]:
                voted[int(r["deputado_id"])].add(r["idVotacao"])
    roll_calls = {v: d for v, d in plenary.items() if any(v in s for s in voted.values())}
    # The plenary's deliberative sessions and who was registered present at each: the basis
    # of the Câmara's own attendance record.
    sessions: dict[str, date] = {}
    present: dict[int, set[str]] = defaultdict(set)
    for y in range(CAMARA_START.year, TODAY.year + 1):
        plen = {
            r["idEvento"]
            for r in rows(cached(f"eventosOrgaos-{y}.csv", FILES.format(kind="eventosOrgaos", year=y)))
            if r["siglaOrgao"] == "PLEN"
        }
        for r in rows(cached(f"eventos-{y}.csv", FILES.format(kind="eventos", year=y))):
            if (
                r["id"] in plen
                and r["descricaoTipo"].startswith("Sessão Deliberativa")
                and not r["situacao"].startswith("Cancelad")
                and r["dataHoraInicio"][:10] >= CAMARA_START.isoformat()
            ):
                sessions[r["id"]] = date.fromisoformat(r["dataHoraInicio"][:10])
        kind = "eventosPresencaDeputados"
        for r in rows(cached(f"{kind}-{y}.csv", FILES.format(kind=kind, year=y))):
            if r["idEvento"] in sessions and r["idDeputado"]:
                present[int(r["idDeputado"])].add(r["idEvento"])
    # The allowance, by deputy and month.
    spent: dict[int, float] = defaultdict(float)
    for y in range(CAMARA_START.year, TODAY.year + 1):
        path = cached(f"cota-{y}.csv.zip", f"https://www.camara.leg.br/cotas/Ano-{y}.csv.zip")
        for r in rows(path, f"Ano-{y}.csv"):
            if r["ideCadastro"].strip() and r["codLegislatura"] == "57":
                with contextlib.suppress(ValueError):
                    spent[int(r["ideCadastro"])] += float(r["vlrLiquido"].replace(",", "."))
    out = []
    for d in deps:
        ps = periods[d["id"]]
        if not ps:  # no status record this term: in office since their first vote
            first = min((plenary[v] for v in voted[d["id"]]), default=None)
            ps = [(first, TODAY)] if first else []

        def inside(day: date, ps: list[tuple[date, date]] = ps) -> bool:
            return any(a <= day <= b for a, b in ps)

        held = [s for s, day in sessions.items() if inside(day)]
        attended = sum(1 for s in held if s in present[d["id"]])
        rolls = [v for v, day in roll_calls.items() if inside(day)]
        voted_in = sum(1 for v in rolls if v in voted[d["id"]])
        in_months = set().union(*(months_between(a, b) for a, b in ps)) if ps else set()
        out.append(
            member(
                d["nome"], d["siglaPartido"], d["siglaUf"], f"https://www.camara.leg.br/deputados/{d['id']}",
                spend_fields(spent[d["id"]], len(in_months), CAP_CAMARA.get(d["siglaUf"])),
                presence_fields(attended, len(held), "sessões deliberativas do plenário"),
            )
        )  # fmt: skip
        out[-1]["rollCalls"] = {"voted": voted_in, "held": len(rolls)} if rolls else None
    return out


# --- Senado ---------------------------------------------------------------------------------

VOTED = {"Sim", "Não", "Abstenção", "Votou", "Presidente (art. 51 RISF)", "Obstrução", "P-NRV"}
JUSTIFIED = {"AP", "LS", "LP", "LAP", "LC", "LG", "MIS", "MERC", "REP"}


def senado() -> list[dict]:
    members = json.loads(download(SENATE_LIST, "application/json"))["ListaParlamentarEmExercicio"][
        "Parlamentares"
    ]["Parlamentar"]
    held: dict[str, int] = defaultdict(int)
    cast: dict[str, int] = defaultdict(int)
    present_months: dict[str, set[str]] = defaultdict(set)
    for y, m in months():
        for v in senado_json(f"votacoes-{y}-{m:02d}.json", "") or []:
            for x in v.get("votos") or []:
                code, vote = str(x["codigoParlamentar"]), x["siglaVotoParlamentar"]
                present_months[code].add(f"{y}-{m:02d}")
                if vote in JUSTIFIED:
                    continue
                held[code] += 1
                cast[code] += vote in VOTED
    spent: dict[str, float] = defaultdict(float)
    for y in range(2023, TODAY.year + 1):
        path = SENADO_RAW / f"ceaps-{y}.csv"
        if not path.exists():
            path.write_bytes(download(CEAPS.format(year=y)))
        for r in csv.DictReader(path.read_text(encoding="latin-1").splitlines()[1:], delimiter=";"):
            if f"{r['ANO']}-{int(r['MES']):02d}" < "2023-02":
                continue
            with contextlib.suppress(ValueError):
                spent[plain(r["SENADOR"])] += float(r["VALOR_REEMBOLSADO"].replace(".", "").replace(",", "."))

    def spent_by(ident: dict) -> float:
        """CEAPS names senators its own way ("WEVERTON ROCHA" for "Weverton"): the exact name,
        else the one CEAPS name that starts with it and is part of the full name."""
        name = plain(ident["NomeParlamentar"])
        if name in spent:
            return spent[name]
        full = set(plain(ident.get("NomeCompletoParlamentar") or "").split())
        found = [k for k in spent if k.startswith(name + " ") and set(k.split()) <= full]
        return spent[found[0]] if len(found) == 1 else 0.0

    out = []
    for m in members:
        ident = m["IdentificacaoParlamentar"]
        # Someone sworn in days ago may have their state only in the term's record.
        code = ident["CodigoParlamentar"]
        uf = ident.get("UfParlamentar") or (m.get("Mandato") or {}).get("UfParlamentar")
        out.append(
            member(
                ident["NomeParlamentar"], ident.get("SiglaPartidoParlamentar", ""), uf,
                ident.get("UrlPaginaParlamentar") or f"{SENATE_PAGE}{code}",
                # Not as a share of the Senate's published ceilings: averages above 100% show that
                # table is not the whole story (unused balance carries over), so the value alone.
                spend_fields(spent_by(ident), len(present_months[code]), None),
                presence_fields(cast[code], held[code], "votações nominais do plenário"),
            )
        )  # fmt: skip
    return out


# --- Alesp ----------------------------------------------------------------------------------

ALESP_START = date(2023, 3, 15)  # the 20th legislature


def alesp_file(path: str) -> ET.Element:
    local = ALESP_RAW / Path(path).name
    if not local.exists() or date.fromtimestamp(local.stat().st_mtime) < TODAY.replace(day=1):
        ALESP_RAW.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(ALESP_FILES + path, headers={"User-Agent": "Mozilla/5.0 urna"})
        with urllib.request.urlopen(req, timeout=600) as r:
            local.write_bytes(r.read())
    return ET.parse(local).getroot()


def day(text: str | None) -> date | None:
    return date.fromisoformat(text[:10]) if text else None


def alesp() -> list[dict]:
    deps = [d for d in alesp_file("deputados/deputados.xml") if d.findtext("Situacao") == "EXE"]
    by_name = {plain(d.findtext("NomeParlamentar") or ""): d for d in deps}
    # Committee meetings held, and who attended, this legislature.
    meetings: dict[str, set[tuple[str, date]]] = defaultdict(set)  # committee → (meeting, day)
    attended: dict[str, set[str]] = defaultdict(set)  # deputy (plain name) → meetings
    for p in alesp_file("processo_legislativo/comissoes_permanentes_presencas.xml"):
        when = day(p.findtext("DataReuniao"))
        if not when or when < ALESP_START:
            continue
        meeting = p.findtext("IdReuniao") or ""
        meetings[p.findtext("SiglaComissao") or ""].add((meeting, when))
        attended[plain(p.findtext("Deputado") or "")].add(meeting)
    # Full memberships (Efetivo S) and their dates: the meetings each one should have attended.
    expected: dict[str, set[str]] = defaultdict(set)
    for m in alesp_file("processo_legislativo/comissoes_membros.xml"):
        if m.findtext("Efetivo") != "S":
            continue
        start = day(m.findtext("DataInicio")) or ALESP_START
        end = day(m.findtext("DataFim")) or TODAY
        for meeting, when in meetings.get(m.findtext("SiglaComissao") or "", ()):
            if max(start, ALESP_START) <= when <= end:
                expected[plain(m.findtext("NomeMembro") or "")].add(meeting)
    # The office allowance, by deputy and month.
    spent: dict[str, float] = defaultdict(float)
    spent_months: dict[str, set[str]] = defaultdict(set)
    for e in alesp_file("deputados/despesas_gabinetes.xml"):
        y, mth = int(e.findtext("Ano") or 0), int(e.findtext("Mes") or 0)
        if (y, mth) < (ALESP_START.year, ALESP_START.month):
            continue
        who = plain(e.findtext("Deputado") or "")
        try:
            spent[who] += float(e.findtext("Valor") or 0)
        except ValueError:
            continue
        spent_months[who].add(f"{y}-{mth:02d}")
    out = []
    for key, d in by_name.items():
        should = expected.get(key, set())
        went = len(should & attended.get(key, set()))
        out.append(
            member(
                d.findtext("NomeParlamentar") or "", d.findtext("Partido") or "", "SP",
                f"https://www.al.sp.gov.br/deputado/?matricula={d.findtext('Matricula') or ''}",
                # Months with any reimbursement: one who took the seat later is not averaged over
                # months before it.
                spend_fields(spent.get(key, 0.0), len(spent_months.get(key, ())), None),
                presence_fields(went, len(should), "reuniões das comissões de que é membro titular"),
            )
        )  # fmt: skip
    return out


# --- Câmara Municipal de São Paulo ----------------------------------------------------------

CMSP_START = date(2025, 1, 1)


def cmsp_sessions() -> list[str]:
    """Session days with a presence file (the SPLegis page's tree), this legislature."""
    page = download(CMSP_PRESENCE + "Presencas.html").decode("utf-8", "ignore")
    when = lambda d: date(int(d[6:]), int(d[3:5]), int(d[:2]))  # noqa: E731  ("dd_mm_yyyy")
    days = sorted({d for d in re.findall(r'id="(\d{2}_\d{2}_\d{4})"', page)}, key=when)
    return [d for d in days if when(d) >= CMSP_START]


def cmsp() -> list[dict]:
    CMSP_RAW.mkdir(parents=True, exist_ok=True)
    present: dict[str, int] = defaultdict(int)
    held: dict[str, int] = defaultdict(int)
    party: dict[str, str] = {}
    last_day: dict[str, str] = {}
    for d in cmsp_sessions():
        path = CMSP_RAW / f"presencas_{d}.xml"
        if not path.exists():
            path.write_bytes(download(f"{CMSP_PRESENCE}PRESENCAS_{d}.xml"))
        root = ET.fromstring(path.read_bytes())
        for v in root.findall("Vereador"):
            name = v.get("Nome") or ""
            party[name] = v.get("Partido") or ""
            last_day[name] = max(last_day.get(name, ""), d[6:] + d[3:5] + d[:2])
            for s in v.findall("Sessao"):
                held[name] += 1
                present[name] += (s.get("Presenca") or "").strip() == "Presente"
    latest = max(last_day.values(), default="")
    spent: dict[str, float] = defaultdict(float)
    spent_months: dict[str, set[str]] = defaultdict(set)
    for key in sorted(months_between(CMSP_START, TODAY)):
        y, mth = int(key[:4]), int(key[5:])
        path = CMSP_RAW / f"despesas_{key}.json"
        if not path.exists() or key == month_key(TODAY):
            body = urllib.parse.urlencode({"ano": y, "mes": mth}).encode()
            req = urllib.request.Request(CMSP_ALLOWANCE, data=body, headers={"User-Agent": "urna/1.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                path.write_bytes(r.read())
        for e in json.loads(path.read_text(encoding="utf-8") or "[]"):
            if e.get("TIPODEPARTAMENTO") != 1:
                continue  # party leaderships have their own allowance
            who = plain(e.get("VEREADOR") or "")
            spent[who] += float(e.get("VALOR") or 0)
            spent_months[who].add(key)
    out = []
    for name in sorted(n for n, d in last_day.items() if d == latest):  # in the latest session: in office
        key = plain(name)
        out.append(
            member(
                name.title(), party[name], "SP", "https://www.saopaulo.sp.leg.br/vereadores/",
                spend_fields(spent.get(key, 0.0), len(spent_months.get(key, ())), None),
                presence_fields(present[name], held[name], "sessões do plenário"),
            )
        )  # fmt: skip
    return out


# --- Build ----------------------------------------------------------------------------------


def link_profiles(key: str, members: list[dict]) -> None:
    """Each member of Congress's code in their house (from the official page's address), and the
    profile in the Eleitos 2026 tab of whoever was elected in 2026 (pipeline.mandate's join)."""
    if key not in ("camara", "senado"):
        return
    path = DATA / "generated" / "mandate.json"
    people = json.loads(path.read_text(encoding="utf-8"))["people"] if path.exists() else {}
    profile = {(e["house"], str(e["id"])): pid for pid, e in people.items()}
    for m in members:
        code = re.search(r"(\d+)/?$", m["url"])
        if code:
            m["id"] = code.group(1)
            if (key, m["id"]) in profile:
                m["profile"] = profile[key, m["id"]]


def main() -> int:
    out: dict = {"date": TODAY.isoformat(), "minMonths": MIN_MONTHS, "houses": {}}
    for key, build, since in (
        ("camara", camara, CAMARA_START),
        ("senado", senado, CAMARA_START),
        ("alesp", alesp, ALESP_START),
        ("cmsp", cmsp, CMSP_START),
    ):
        print(f"{key}…", flush=True)
        try:
            members = build()
        except Exception as e:  # one house's source down does not stop the others
            print(f"  {key}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        ranked_spend = sum(1 for m in members if m["spend"])
        ranked_presence = sum(1 for m in members if m["presence"])
        print(f"  {len(members)} members; {ranked_spend} with spending, {ranked_presence} with presence")
        link_profiles(key, members)
        out["houses"][key] = {"since": since.isoformat(), "members": members}
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
