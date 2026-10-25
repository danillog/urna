"""Builds data/generated/congress.json: seats per party in Congress, left to right.

    uv run python -m pipeline.congress                 # build from data/
    uv run python -m pipeline.congress --refresh-2026  # read 2026 from the TSE and the Senate first

Inputs:
- data/congress.yaml: seats per election, and how each party is placed.
- data/raw/congress/bls9_party_ideology.tab: Zucco & Power's party estimates.
- data/raw/congress/2026.yaml: the 2026 delegations, written by --refresh-2026
  from the TSE count (deputies by state, senators by state) and the Senate's
  open data (the 27 senators elected in 2022, by their current party).

Each party gets a score on Zucco & Power's scale (about −1 left to +1 right)
for each election, the source of that score, and one of five groups.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

import yaml

from .build import DATA
from .sources.http import get, get_json

CONFIG = DATA / "congress.yaml"
BLS = DATA / "raw" / "congress" / "bls9_party_ideology.tab"
RAW_2026 = DATA / "raw" / "congress" / "2026.yaml"
OUTPUT = DATA / "generated" / "congress.json"

TSE = "https://resultados.tse.jus.br/oficial/ele2026/6259/dados"
SENATE_API = "https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json"
UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
    "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]  # fmt: skip
# The Senate term that started in 2023 and runs to 2031: senators elected in 2022.
TERM_FROM_2022 = "57"
# TSE and Senate acronyms → the ones used in data/congress.yaml.
ACRONYMS = {
    "PC DO B": "PCdoB",
    "PCDOB": "PCdoB",
    "REPUBLICANOS": "Republicanos",
    "SOLIDARIEDADE": "SD",
    "CIDADANIA": "Cidadania",
    "AVANTE": "Avante",
    "PODEMOS": "PODE",
    "MOBILIZA": "Mobiliza",
    "PATRIOTA": "Patriota",
    "AGIR": "Agir",
    "UNIAO": "UNIÃO",
}
# Years a party's estimate may be borrowed from another wave when its own is missing.
MAX_WAVE_GAP = 4
GROUPS = ["left", "centre-left", "centre", "centre-right", "right"]


# --- Placement ------------------------------------------------------------------------


def read_bls(path: Path = BLS) -> dict[str, dict[int, float]]:
    """Zucco & Power's party estimates: party → wave year → score. Presidents are dropped."""
    out: dict[str, dict[int, float]] = defaultdict(dict)
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            name = row["party.or.pres"].strip('"')
            if name in PRESIDENTS:
                continue
            out[name][int(row["year"])] = float(row["ideo"])
    return dict(out)


PRESIDENTS = {"LULA", "DILMA", "FHC", "ITAMAR", "SARNEY", "COLLOR", "TEMER", "BOLSONARO"}


def fit_line(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Least squares: y ≈ a + b·x."""
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / sum((x - mx) ** 2 for x in xs)
    return my - b * mx, b


class Placer:
    """Scores a party, as written in a given election year."""

    def __init__(self, config: dict, bls: dict[str, dict[int, float]]):
        self.rules = config["placement"]
        self.bls = bls
        bolognesi = config["bolognesi"]
        pairs = [
            (bolognesi[b], bls[z][2017])
            for b, z in config["bolognesi_to_bls"].items()
            if 2017 in bls.get(z, {})
        ]
        self.a, self.b = fit_line([x for x, _ in pairs], [y for _, y in pairs])
        self.bolognesi = bolognesi
        self.cuts = config["groups"]

    @staticmethod
    def wave(year: int) -> int:
        """The survey taken during the term an election starts: 1990 → 1993, …; 2021 at most."""
        return min(year + 3, 2021)

    def rule(self, party: str, year: int) -> dict | None:
        rule = self.rules.get(party)
        if isinstance(rule, list):
            rule = next((r for r in rule if r.get("since", 0) <= year <= r.get("until", 9999)), None)
        return rule

    def score(self, party: str, year: int) -> tuple[float | None, str | None]:
        """(score, source); (None, None) when the party is not placed."""
        rule = self.rule(party, year)
        if not rule:
            return None, None
        if "bls" in rule:
            waves = self.bls[rule["bls"]]
            wave = self.wave(year)
            if wave in waves:
                return waves[wave], f"bls-{wave}"
            near = min(waves, key=lambda w: (abs(w - wave), w))
            # A party can change a lot in a decade (the PSL of 2002 is not the one of
            # 2021): borrow a neighbouring wave only.
            if abs(near - wave) > MAX_WAVE_GAP:
                return None, None
            return waves[near], f"bls-{near}"
        if "bolognesi" in rule:
            return self.a + self.b * self.bolognesi[rule["bolognesi"]], "bolognesi"
        if "mean" in rule:
            parts = [self.score(p, year)[0] for p in rule["mean"]]
            if None in parts:
                return None, None
            return sum(parts) / len(parts), "mean:" + "+".join(rule["mean"])  # type: ignore[arg-type]
        raise ValueError(f"placement of {party}: {rule}")

    def lineage(self, party: str, year: int) -> str:
        """The party's line through renames (PFL and DEM are one), named after its placement."""
        rule = self.rule(party, year)
        if rule and "bls" in rule:
            return rule["bls"]
        if rule and "bolognesi" in rule:
            return rule["bolognesi"]
        return party

    def group(self, score: float | None) -> str | None:
        if score is None:
            return None
        for name in GROUPS[:-1]:
            if score < self.cuts[name]:
                return name
        return GROUPS[-1]


# --- 2026 -----------------------------------------------------------------------------


def acronym(sg: str) -> str:
    key = sg.strip().upper().replace("Ã", "A")
    return ACRONYMS.get(key, sg.strip())


def num(v: object) -> float:
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return 0.0


def project_seats(lists: list[dict], cands: list[dict], seats: int, valid: int) -> None:
    """Marks `elected` on candidates as the law would if the count stopped now; the same
    rules as projectSeats in src/model/apuracao.ts (Código Eleitoral, arts. 106–109)."""
    if not valid:
        return
    qe = round(valid / seats)
    by_list: dict[str, list[dict]] = defaultdict(list)
    for c in sorted(cands, key=lambda c: -c["votes"]):
        by_list[c["list"]].append(c)
    won = Counter()

    def take(key: str, min_votes: float) -> bool:
        open_ = (c for c in by_list[key] if not c["elected"] and c["votes"] >= min_votes and c["votes"])
        nxt = next(open_, None)
        if not nxt:
            return False
        nxt["elected"] = True
        won[key] += 1
        return True

    left = seats
    for lst in lists:
        for _ in range(lst["votes"] // qe):
            if left <= 0 or not take(lst["key"], 0.1 * qe):
                break
            left -= 1

    def leftovers(eligible: list[dict], min_votes: float) -> None:
        nonlocal left
        open_ = list(eligible)
        while left > 0 and open_:
            best = max(open_, key=lambda lst: lst["votes"] / (won[lst["key"]] + 1))
            if take(best["key"], min_votes):
                left -= 1
            else:
                open_.remove(best)

    leftovers([lst for lst in lists if lst["votes"] >= 0.8 * qe], 0.2 * qe)
    leftovers(lists, 0)


def deputies(uf: str, office_code: int = 6) -> tuple[Counter, bool]:
    """Seats per party in a state's delegation (6: federal deputies, 7: the state assembly),
    and whether they are the TSE's (not ours)."""
    raw = json.loads(get(f"{TSE}/{uf.lower()}/{uf.lower()}-c{office_code:04d}-e006259-u.json"))
    office = raw["carg"][0]
    lists, cands = [], []
    for group in office["agr"]:
        votes = 0
        for party in group["par"]:
            votes += int(num(party.get("tvtn")) + num(party.get("tvtl")))
            for c in party["cand"]:
                status = str(c.get("st", ""))
                cands.append(
                    {
                        "list": group["n"],
                        "party": acronym(party["sg"]),
                        "votes": int(num(c.get("vap"))),
                        "elected": status.startswith("Eleito"),
                        "status": status,
                    }
                )
        lists.append({"key": group["n"], "votes": votes})
    official = any(c["elected"] for c in cands)
    if not official:
        lists.sort(key=lambda lst: -lst["votes"])
        project_seats(lists, cands, int(num(office["nv"])), int(num(raw["v"]["vv"])))
    return Counter(c["party"] for c in cands if c["elected"]), official


def senators(uf: str) -> Counter:
    """The two elected in a state: the TSE's word, or the two most voted."""
    raw = json.loads(get(f"{TSE}/{uf.lower()}/{uf.lower()}-c0005-e006259-u.json"))
    office = raw["carg"][0]
    cands = [
        (int(num(c.get("vap"))), acronym(p["sg"]), str(c.get("st", "")))
        for g in office["agr"]
        for p in g["par"]
        for c in p["cand"]
    ]
    elected = [c for c in cands if c[2].startswith("Eleito")]
    chosen = elected or sorted(cands, reverse=True)[: int(num(office["nv"]))]
    return Counter(party for _, party, _ in chosen)


def refresh_2026() -> None:
    chamber, senate, official = Counter(), Counter(), True
    for uf in UFS:
        seats, is_official = deputies(uf)
        chamber += seats
        official &= is_official
        senate += senators(uf)
    # The 27 senators elected in 2022 stay until 2031: counted by the party they were elected
    # for, like every other seat (their party today is in the "today" view).
    senate += Counter(acronym(r["SG_PARTIDO"]) for r in elected_rows(2022, "SENADOR"))
    out = {
        "provisional": not official,
        "chamber": dict(chamber.most_common()),
        "senate": dict(senate.most_common()),
    }
    header = (
        "# Written by `uv run python -m pipeline.congress --refresh-2026`.\n"
        "# provisional: true while the TSE has not named the deputies; seats are then\n"
        "# projected by the electoral quotient from the votes counted.\n"
    )
    RAW_2026.write_text(header + yaml.safe_dump(out, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"  2026: {sum(chamber.values())} deputies, {sum(senate.values())} senators -> {RAW_2026.name}")


# --- São Paulo: the state assembly (Alesp) and the city council ------------------------------

RAW_SP = DATA / "raw" / "congress" / "sp.yaml"
SAO_PAULO_TSE = "71072"  # the city's code at the TSE
ALESP_YEARS = (2010, 2014, 2018, 2022)
CMSP_YEARS = (2012, 2016, 2020, 2024)
# "MÉDIA" alone is how the 2010 file writes "elected by the highest averages".
ELECTED_ANY = (*("ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA", "ELEITO POR MEDIA"), "MÉDIA")


def refresh_sp() -> None:
    """Writes data/raw/congress/sp.yaml: seats per party in the Alesp after each election since
    2010 (2026 from the count, like the Chamber) and in São Paulo's city council since 2012,
    from the TSE's candidate files (pipeline.profiles' cache)."""
    from .profiles import candidate_rows

    def seats(year: int, office: str, keep) -> dict[str, int]:
        rows = [
            r for r in candidate_rows(year)
            if r["DS_CARGO"].upper() == office and keep(r)
            and r.get("DS_SIT_TOT_TURNO", "").upper() in ELECTED_ANY
        ]  # fmt: skip
        return dict(Counter(acronym(r["SG_PARTIDO"]) for r in rows).most_common())

    alesp = {y: seats(y, "DEPUTADO ESTADUAL", lambda r: r["SG_UF"] == "SP") for y in ALESP_YEARS}
    now, official = deputies("SP", 7)
    alesp[2026] = dict(now.most_common())
    cmsp = {y: seats(y, "VEREADOR", lambda r: r.get("SG_UE") == SAO_PAULO_TSE) for y in CMSP_YEARS}
    out = {"provisional2026": not official, "alesp": alesp, "cmsp": cmsp}
    header = (
        "# Written by `uv run python -m pipeline.congress --refresh-sp`: Alesp and São Paulo's council.\n"
    )
    RAW_SP.write_text(header + yaml.safe_dump(out, allow_unicode=True, sort_keys=False), encoding="utf-8")
    for name, h in (("alesp", alesp), ("cmsp", cmsp)):
        print(f"  {name}: " + ", ".join(f"{y} ({sum(s.values())})" for y, s in h.items()))


# --- Today: the seats by party now, and who changed party since elected --------------

RAW_NOW = DATA / "raw" / "congress" / "now.yaml"
ELECTED = ("ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA", "ELEITO POR MEDIA")
CAMARA_FILE = DATA / "raw" / "profiles" / "camara_deputados.json"


def elected_rows(year: int, office: str) -> list[dict]:
    """The TSE's candidate rows of those elected to an office in a year (pipeline.profiles' cache)."""
    from .profiles import candidate_rows  # profiles imports this module

    return [
        r
        for r in candidate_rows(year)
        if r["DS_CARGO"].upper() == office and r.get("DS_SIT_TOT_TURNO", "").upper() in ELECTED
    ]


def plain_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z ]", " ", text).split())


def refresh_now() -> None:
    """Writes data/raw/congress/now.yaml: each house by party today, and each member whose
    party today differs from the one elected for. Deputies are matched to their 2022
    candidacy by CPF (never written out), senators by name and state. A party that ran no
    candidate in 2026 no longer exists (merged or folded): its members are flagged so, not
    counted as switching."""
    from .profiles import candidate_rows

    alive = {acronym(r["SG_PARTIDO"]) for r in candidate_rows(2026)}
    camara = json.loads(CAMARA_FILE.read_text(encoding="utf-8"))
    sitting = {
        cpf: d["ultimoStatus"]
        for cpf, d in camara.items()
        if (d.get("ultimoStatus") or {}).get("idLegislatura") == 57
        and d["ultimoStatus"].get("situacao") in ("Exercício", "Licença")
    }
    chamber = Counter(
        acronym(s["siglaPartido"]) for s in sitting.values() if s.get("situacao") == "Exercício"
    )
    switches = []
    for r in elected_rows(2022, "DEPUTADO FEDERAL"):
        now = sitting.get(r.get("NR_CPF_CANDIDATO", ""))
        if not now:
            continue  # left the seat (minister's substitute in, died, lost the mandate)
        before, after = acronym(r["SG_PARTIDO"]), acronym(now["siglaPartido"])
        if before != after:
            switches.append({"name": now.get("nome") or r["NM_URNA_CANDIDATO"], "house": "chamber",
                             "uf": r["SG_UF"], "from": before, "to": after,
                             "extinct": before not in alive})  # fmt: skip
    members = get_json(SENATE_API)["ListaParlamentarEmExercicio"]["Parlamentares"]["Parlamentar"]
    senate = Counter(acronym(m["IdentificacaoParlamentar"]["SiglaPartidoParlamentar"]) for m in members)
    rows = {(plain_name(r["NM_CANDIDATO"]), r["SG_UF"]): r
            for y in (2018, 2022) for r in elected_rows(y, "SENADOR")}  # fmt: skip
    for m in members:
        ident = m["IdentificacaoParlamentar"]
        r = rows.get((plain_name(ident["NomeCompletoParlamentar"]), ident["UfParlamentar"]))
        if not r:
            continue  # a substitute in the seat
        before, after = acronym(r["SG_PARTIDO"]), acronym(ident["SiglaPartidoParlamentar"])
        if before != after:
            switches.append({"name": ident["NomeParlamentar"], "house": "senate",
                             "uf": ident["UfParlamentar"], "from": before, "to": after,
                             "extinct": before not in alive})  # fmt: skip
    out = {
        "date": datetime.now(UTC).date().isoformat(),
        "chamber": dict(chamber.most_common()),
        "senate": dict(senate.most_common()),
        "switches": sorted(switches, key=lambda s: (s["house"], s["uf"], s["name"])),
    }
    header = "# Written by `uv run python -m pipeline.congress --refresh-now`: Congress by party today.\n"
    RAW_NOW.write_text(header + yaml.safe_dump(out, allow_unicode=True, sort_keys=False), encoding="utf-8")
    moved = sum(1 for s in switches if not s["extinct"])
    print(f"  today: {sum(chamber.values())} deputies, {sum(senate.values())} senators; "
          f"{moved} changed party, {len(switches) - moved} whose party folded")  # fmt: skip


# --- Build ----------------------------------------------------------------------------


def build(
    config: dict,
    bls: dict[str, dict[int, float]],
    extra: dict | None,
    now: dict | None = None,
    sp: dict | None = None,
) -> dict:
    placer = Placer(config, bls)
    centrao = config["centrao"]
    houses: dict[str, list] = {"chamber": [], "senate": []}

    def composition(seats: dict[str, int], year: int) -> dict:
        parties = []
        for party, n in seats.items():
            score, source = placer.score(party, year)
            parties.append(
                {
                    "party": party,
                    "lineage": placer.lineage(party, year),
                    "name": config["names"].get(party, party),
                    "seats": n,
                    "score": None if score is None else round(score, 3),
                    "group": placer.group(score),
                    "source": source,
                    "centrao": year >= centrao["since"] and party in centrao["parties"],
                }
            )
        # Left to right; unplaced parties last, largest first.
        parties.sort(key=lambda p: (p["score"] is None, p["score"] or 0, -p["seats"]))
        return {"year": year, "total": sum(seats.values()), "parties": parties}

    for house in houses:
        elections = {int(y): seats for y, seats in config[house].items()}
        provisional = set()
        if extra:
            elections[2026] = extra[house]
            if extra.get("provisional"):
                provisional.add(2026)
        for year, seats in sorted(elections.items()):
            entry = composition(seats, year)
            if year in provisional:
                entry["provisional"] = True
            houses[house].append(entry)
    out = {
        "cuts": config["groups"],
        "bolognesiLine": [round(placer.a, 4), round(placer.b, 4)],
        "centrao": {
            "since": centrao["since"],
            "source": {k: str(v) for k, v in centrao["source"].items()},
        },
        "houses": houses,
    }
    if sp:
        # São Paulo's state assembly and city council: the same placement as Congress (the
        # parties' national scores), seat counts from the TSE.
        for house in ("alesp", "cmsp"):
            houses[house] = []
            for year, seats in sorted((int(y), s) for y, s in sp[house].items()):
                entry = composition(seats, year)
                if house == "alesp" and year == 2026 and sp.get("provisional2026"):
                    entry["provisional"] = True
                houses[house].append(entry)
    if now:
        # Today: the legislature in office (elected in 2022) by the party each member has now.
        year = int(str(now["date"])[:4])
        out["now"] = {
            "date": str(now["date"]),
            "chamber": composition(now["chamber"], year),
            "senate": composition(now["senate"], year),
            "switches": now.get("switches", []),
        }
    return out


PROFILES = DATA / "generated" / "profiles.json"
# Never elected to anything before (pipeline.profiles kinds): first-timers, those who ran
# and lost, those who only held appointed offices.
NEWCOMER_KINDS = {"new", "tried", "appointed"}
HOUSE_OFFICE = {"chamber": "deputado-federal", "senate": "senador"}


def party_key(name: str) -> str:
    """'Republicanos', 'REPUBLICANOS'; 'SD', 'SOLIDARIEDADE': one key."""
    key = re.sub(
        r"[^A-Z0-9]", "", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    )
    return {"SOLIDARIEDADE": "SD"}.get(key, key)


def mark_newcomers(out: dict, profiles: dict) -> None:
    """2026: how many of each party's seats went to someone never elected before."""
    for house, office in HOUSE_OFFICE.items():
        entry = next((e for e in out["houses"][house] if e["year"] == 2026), None)
        if not entry:
            continue
        counts: Counter = Counter(
            party_key(p["party"])
            for p in profiles["people"]
            if p["office"] == office
            and p["status"] in ("elected", "projected")
            and p["kind"] in NEWCOMER_KINDS
        )
        for p in entry["parties"]:
            p["newcomers"] = min(p["seats"], counts.get(party_key(p["party"]), 0))


def main() -> int:
    if "--refresh-2026" in sys.argv[1:]:
        refresh_2026()
    if "--refresh-now" in sys.argv[1:]:
        refresh_now()
    if "--refresh-sp" in sys.argv[1:]:
        refresh_sp()
    config = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    extra = yaml.safe_load(RAW_2026.read_text(encoding="utf-8")) if RAW_2026.exists() else None
    now = yaml.safe_load(RAW_NOW.read_text(encoding="utf-8")) if RAW_NOW.exists() else None
    sp = yaml.safe_load(RAW_SP.read_text(encoding="utf-8")) if RAW_SP.exists() else None
    out = build(config, read_bls(), extra, now, sp)
    if PROFILES.exists():
        mark_newcomers(out, json.loads(PROFILES.read_text(encoding="utf-8")))
    unplaced = sorted(
        {p["party"] for h in out["houses"].values() for e in h for p in e["parties"] if p["score"] is None}
    )
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for house, entries in out["houses"].items():
        print(f"  {house}: " + ", ".join(f"{e['year']} ({e['total']})" for e in entries))
    print(f"  unplaced: {', '.join(unplaced)}")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
