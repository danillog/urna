"""Builds data/generated/governismo.json: how often each party voted with the government.

    uv run python -m pipeline.governismo

In every roll-call vote of the Chamber's plenary, the government's leader and each party's
leader say how their members should vote. A party sides with the government in a vote when
both said "Sim", or both said "Não" (obstruction counts as "Não": it is the minority's way
of voting against). The share of such votes, among those where both gave a yes or no, is the
party's alignment with that government; it is summed per presidential term.

Orientations given by a bloc or a federation ("Fdr PT-PCdoB-PV", "Bl MdbPsdRepPode") count
for each party in it, unless the party gave its own.

Input: Câmara dos Deputados open data, votacoesOrientacoes-<year>.csv and votacoes-<year>.csv
(for the date), 2003 on, cached in data/raw/camara/ (not in git).
"""

from __future__ import annotations

import calendar
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import yaml

from .build import DATA
from .congress import CONFIG, Placer, read_bls
from .sources.http import get

RAW = DATA / "raw" / "camara"
OUTPUT = DATA / "generated" / "governismo.json"
FILES = "https://dadosabertos.camara.leg.br/arquivos/{kind}/csv/{kind}-{year}.csv"
FIRST_YEAR = 2003

# Presidential terms, by the date the vote was taken.
TERMS = [
    ("lula1", "Lula 1", "PT", "2003-01-01", "2006-12-31"),
    ("lula2", "Lula 2", "PT", "2007-01-01", "2010-12-31"),
    ("dilma1", "Dilma 1", "PT", "2011-01-01", "2014-12-31"),
    ("dilma2", "Dilma 2", "PT", "2015-01-01", "2016-05-11"),
    ("temer", "Temer", "MDB", "2016-05-12", "2018-12-31"),
    ("bolsonaro", "Bolsonaro", "PL", "2019-01-01", "2022-12-31"),
    ("lula3", "Lula 3", "PT", "2023-01-01", "2026-12-31"),
]
GOVERNMENT = {"GOVERNO", "GOV."}
# Bancadas that are not parties: their orientation says nothing about one party.
NOT_PARTIES = {"MAIORIA", "MINORIA", "OPOSIÇÃO", "OPOSICAO", "REPR.", "REPR", "PRES.", "S.PART."}
# How the Chamber writes party names → the acronyms of data/congress.yaml.
NAMES = {
    "SOLIDARIED": "SD", "SOLIDARIEDADE": "SD", "REPUBLICAN": "Republicanos", "REPUBLICANOS": "Republicanos",
    "NOVO": "NOVO", "PODEMOS": "PODE", "PODE": "PODE", "CIDADANIA": "Cidadania", "AVANTE": "Avante",
    "PATRIOTA": "Patriota", "UNIÃO": "UNIÃO", "UNIAO": "UNIÃO", "PCDOB": "PCdoB", "PTDOB": "PTdoB",
    # The Senate's spellings.
    "REPUBLICA": "Republicanos", "PROGRES": "PP", "PROGRESSISTAS": "PP",
}  # fmt: skip
# Abbreviations inside bloc names ("Bl MdbPsdRepPode").
BLOC_PARTS = {
    "REP": "Republicanos", "UNI": "UNIÃO", "CID": "Cidadania", "SD": "SD", "SOLID": "SD",
    "AVAN": "Avante", "PTDO": "PTdoB", "PCDO": "PCdoB",
}  # fmt: skip
# Our reading of the shares, written on the page: 70% or more with the government is its base.
BASE, OPPOSITION = 70, 40
# The Centrão as measured: with the government, at this share or more, under at least one PT
# president and one from another party (decided 06/10/2026; see the plan's open decisions).
CENTRAO = 80


def cached(kind: str, year: int) -> Path:
    path = RAW / f"{kind}-{year}.csv"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(FILES.format(kind=kind, year=year)))
    return path


def rows(path: Path):
    with path.open(encoding="utf-8-sig") as f:
        yield from csv.DictReader(f, delimiter=";")


KNOWN = {k.upper(): k for k in yaml.safe_load(CONFIG.read_text(encoding="utf-8"))["placement"]}


def acronym(name: str) -> str:
    """The Chamber's spelling ("Solidaried", "Rede", "PCDOB") → ours ("SD", "REDE", "PCdoB")."""
    key = name.strip().upper()
    return NAMES.get(key) or KNOWN.get(key) or name.strip()


def members(bancada: str) -> list[str]:
    """The parties a bancada stands for: itself, a federation's or a bloc's members."""
    name = bancada.strip()
    # Long bloc names are cut with "...": the last, cut part names nobody.
    truncated = name.endswith("...")
    name = name.rstrip(".")
    if name.upper() in {x.rstrip(".") for x in NOT_PARTIES | GOVERNMENT}:
        return []
    if truncated and not name.startswith(("Bl ", "Fdr ")):
        # A single party cut short ("Avan..."): the one known acronym it starts.
        hits = [v for k, v in KNOWN.items() if k.startswith(name.upper())]
        return hits if len(hits) == 1 else []
    if name.startswith("Fdr "):  # "Fdr PT-PCdoB-PV"
        return [acronym(p) for p in name[4:].split("-") if p]
    if "/" in name:  # "PL/PSL"
        return [acronym(p) for p in name.split("/") if p]
    # Acronyms with lower case inside would split wrong: PCdoB → Pc, do, B.
    body = name.removeprefix("Bl ").replace("Fdr", "").replace("PCdoB", "Pcdob").replace("PTdoB", "Ptdob")
    parts = re.findall(r"[A-Z][a-z]*", body)
    if truncated:
        parts = parts[:-1]
    if name.startswith("Bl ") or (len(parts) > 1 and name.isalpha() and not name.isupper()):
        return [BLOC_PARTS.get(p.upper(), acronym(p.upper())) for p in parts if len(p) > 1]
    return [acronym(name)]


def side(orientation: str) -> str | None:
    o = orientation.strip().upper()
    if o == "SIM":
        return "S"
    if o in ("NÃO", "NAO", "OBSTRUÇÃO", "OBSTRUCAO"):
        return "N"
    return None  # released, absent, blank


def term_of(day: str) -> str | None:
    return next((key for key, _, _, start, end in TERMS if start <= day <= end), None)


# The Senate's API has the leaders' orientations from 2019 on.
SENATE_FROM = (2019, 2)


def senate(placer) -> tuple[dict, str]:
    """Lineage → term → share of contested roll calls where the party's leader in the Senate
    oriented as the government's; same reading as the Chamber's."""
    from .mandate import SENADO, senado_json  # mandate imports this module

    today = datetime.now(UTC).date()
    agree: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    y, m = SENATE_FROM
    while (y, m) <= (today.year, today.month):
        last = calendar.monthrange(y, m)[1]
        data = senado_json(
            f"orientacoes-{y}-{m:02d}.json",
            f"{SENADO}/plenario/votacao/orientacaoBancada/{y}{m:02d}01/{y}{m:02d}{last}",
            refresh=(y, m) == (today.year, today.month),
        )
        for v in (data or {}).get("votacoes") or []:
            day = str(v.get("dataInicioVotacao", ""))[:10]
            term = term_of(day)
            given = v.get("orientacoesLideranca") or []
            sides = {o["partido"].strip(): side(o.get("voto") or "") for o in given}
            gov = next((o for p, o in sides.items() if p.upper().rstrip(".") in GOVERNMENT), None)
            if not gov or not term:
                continue
            parties = {p: o for p, o in sides.items() if p.upper().rstrip(".") not in GOVERNMENT}
            if not any(o and o != gov for o in parties.values()):
                continue
            for bancada, o in parties.items():
                # Women's caucus ("Banc Fem", "B.Feminina"): not a party.
                caucus = bancada.startswith(("Banc", "B."))
                if o is None or caucus or bancada.upper().rstrip(".") in NOT_PARTIES:
                    continue
                for party in members(bancada):
                    cell = agree[(placer.lineage(party, int(day[:4])), term)]
                    cell[0] += o == gov
                    cell[1] += 1
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    out: dict = {}
    for (lineage, term), (with_gov, total) in sorted(agree.items()):
        if total < 20:
            continue
        out.setdefault(lineage, {})[term] = {"share": round(with_gov / total * 100, 1), "votes": total}
    return out, f"{SENATE_FROM[0]}-{SENATE_FROM[1]:02d}"


def main() -> int:
    last = (
        int(sorted(p.stem[-4:] for p in RAW.glob("votacoes-*.csv"))[-1])
        if RAW.exists() and any(RAW.glob("votacoes-*.csv"))
        else 2026
    )
    config = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    placer = Placer(config, read_bls())
    agree: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])  # (lineage, term) → [with, of]
    names_seen: dict[str, set[str]] = defaultdict(set)
    for year in range(FIRST_YEAR, max(last, 2026) + 1):
        try:
            days = {
                r["id"]: r["data"] for r in rows(cached("votacoes", year)) if r.get("siglaOrgao") == "PLEN"
            }
            orientations = list(rows(cached("votacoesOrientacoes", year)))
        except Exception as e:  # a year not published yet
            print(f"  {year}: {type(e).__name__}", file=sys.stderr)
            continue
        by_vote: dict[str, dict] = defaultdict(lambda: {"gov": None, "own": {}, "bloc": {}, "other": []})
        for r in orientations:
            vote = r["idVotacao"]
            if vote not in days:
                continue
            o = side(r["orientacao"])
            bancada = r["siglaBancada"].strip()
            if bancada.upper().rstrip(".") in {g.rstrip(".") for g in GOVERNMENT}:
                by_vote[vote]["gov"] = o
                continue
            if bancada.upper().rstrip(".") in NOT_PARTIES:  # "Oposição", "Minoria": they count for contest
                by_vote[vote]["other"].append(o)
                continue
            parties = members(bancada)
            target = "own" if len(parties) == 1 and not bancada.startswith(("Bl ", "Fdr ")) else "bloc"
            for p in parties:
                by_vote[vote][target][p] = o
        n = 0
        for vote, v in by_vote.items():
            term = term_of(days[vote])
            if v["gov"] is None or term is None:
                continue
            # Only contested votes: some bancada asked for the opposite of the government.
            # Near-unanimous votes would make everyone look like the government's ally.
            if not any(o and o != v["gov"] for o in [*v["own"].values(), *v["bloc"].values(), *v["other"]]):
                continue
            for party, o in {**v["bloc"], **v["own"]}.items():  # own orientation wins
                if o is None:
                    continue
                lineage = placer.lineage(party, year)
                names_seen[lineage].add(party)
                cell = agree[(lineage, term)]
                cell[0] += o == v["gov"]
                cell[1] += 1
                n += 1
        print(f"  {year}: {n} party positions in contested plenary votes")

    out: dict = {
        "terms": [
            {"key": k, "label": label, "party": party, "from": a, "to": b} for k, label, party, a, b in TERMS
        ],
        "thresholds": {"base": BASE, "opposition": OPPOSITION, "centrao": CENTRAO},
        "parties": {},
    }
    for (lineage, term), (with_gov, total) in sorted(agree.items()):
        if total < 20:  # too few votes to say
            continue
        out["parties"].setdefault(lineage, {})[term] = {
            "share": round(with_gov / total * 100, 1),
            "votes": total,
        }
    print("Senate…", flush=True)
    out["senate"], out["senateSince"] = senate(placer)
    print(f"  {len(out['senate'])} parties in the Senate since {out['senateSince']}")
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  {len(out['parties'])} parties")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
