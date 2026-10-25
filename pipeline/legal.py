"""Criminal cases of the people elected in 2026, from data/legal.yaml: checked by hand, one
official document per case. Adds them to data/generated/profiles.json.

    uv run python -m pipeline.legal               # validate data/legal.yaml, add to the profiles
    uv run python -m pipeline.legal --checklist   # write the private checklist (not in git)

Calling someone a suspect or a convict is the riskiest thing the site can say, so nothing
here is automatic:

- No source can be read by a script. The STF (where deputies and senators are tried) has
  no open data on cases by party and its portal refuses automated access; DataJud (CNJ)
  searches by case number only. The TSE's cassation file is not one either: most records
  are formal (a missing document, the party's paperwork), and "inelegibilidade (LC 64/90)"
  does not say whether it is a conviction or rejected accounts.
- So each case is looked up by a person, in the court's own page, and written down with
  its grade, crime, court, number, date, link and the day it was checked. The checklist
  lists everyone elected with a link to the STF's search by name, to go through by hand.
- Grades are kept apart: inquiry ("investigado"), indictment received ("réu"), convicted
  with appeal pending, convicted for good (no appeal left). Closed inquiries and
  acquittals stay only as history, said as such. The page writes the presumption of
  innocence next to everything that is not a final conviction.
- Every link must be official (a court, prosecution service or government domain), and
  the same criteria apply to every party.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
from datetime import date, timedelta

import yaml

from .build import DATA

SOURCE = DATA / "legal.yaml"
PROFILES = DATA / "generated" / "profiles.json"
CHECKLIST = DATA / "raw" / "legal" / "checklist.md"

GRADES = {
    "investigado": "inquiry open",
    "reu": "indictment received: on trial",
    "condenado-recorrivel": "convicted, appeal pending",
    "condenado-definitivo": "convicted, no appeal left",
    "arquivado": "inquiry closed (history only)",
    "absolvido": "acquitted (history only)",
}
OFFICIAL = re.compile(r"^https://([a-z0-9-]+\.)*(jus\.br|mp\.br|gov\.br|leg\.br)(/|$)")
CASE_NUMBER = re.compile(r"^[A-Za-z]{2,4} \d[\d.]*$|^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$")
FIELDS = ("person", "grade", "crime", "court", "case", "since", "url", "checked", "checkedBy")
# A case not looked at again for this long is flagged on the page as possibly out of date.
STALE = timedelta(days=180)


class LegalError(ValueError):
    pass


def validate(cases: list[dict], people: set[str], today: date) -> list[str]:
    """Raises on any malformed case; returns warnings (stale checks)."""
    warnings = []
    seen = set()
    for k, c in enumerate(cases, 1):
        where = f"data/legal.yaml, case {k}"
        missing = [f for f in FIELDS if not c.get(f)]
        if missing:
            raise LegalError(f"{where}: missing {', '.join(missing)}")
        if c["person"] not in people:
            raise LegalError(f"{where}: no elected person {c['person']!r} in profiles.json")
        if c["grade"] not in GRADES:
            raise LegalError(f"{where}: grade must be one of {', '.join(GRADES)}")
        if not OFFICIAL.match(str(c["url"])):
            raise LegalError(f"{where}: the link must be official (.jus.br, .mp.br, .gov.br, .leg.br)")
        if not CASE_NUMBER.match(str(c["case"])):
            raise LegalError(f"{where}: case number like 'AP 1044', 'Inq 4781' or the CNJ's 20-digit number")
        for f in ("since", "checked"):
            if not isinstance(c[f], date):
                raise LegalError(f"{where}: {f} must be a date (yyyy-mm-dd)")
        if c["checked"] > today or c["since"] > c["checked"]:
            raise LegalError(f"{where}: dates out of order")
        key = (c["person"], c["case"])
        if key in seen:
            raise LegalError(f"{where}: {c['case']} listed twice for {c['person']}")
        seen.add(key)
        if today - c["checked"] > STALE:
            warnings.append(f"{where}: last checked {c['checked']}, check again")
    return warnings


def public(c: dict, today: date) -> dict:
    """What the page shows: no reviewer name; dates as text; whether it may be out of date."""
    return {
        "grade": c["grade"],
        "crime": c["crime"],
        "court": c["court"],
        "case": c["case"],
        "since": c["since"].isoformat(),
        "url": c["url"],
        "checked": c["checked"].isoformat(),
        "stale": today - c["checked"] > STALE,
        **({"note": c["note"]} if c.get("note") else {}),
    }


def merge(profiles: dict, cases: list[dict], today: date) -> dict:
    by_person: dict[str, list[dict]] = {}
    for c in cases:
        by_person.setdefault(c["person"], []).append(public(c, today))
    for p in profiles["people"]:
        if p["id"] in by_person:
            p["legal"] = sorted(by_person[p["id"]], key=lambda c: c["since"], reverse=True)
        else:
            p.pop("legal", None)
    profiles["legalChecked"] = max((c["checked"] for c in cases), default=None)
    if profiles["legalChecked"]:
        profiles["legalChecked"] = profiles["legalChecked"].isoformat()
    return profiles


def stf_search(name: str) -> str:
    return "https://portal.stf.jus.br/processos/listarPartes.asp?" + urllib.parse.urlencode({"termo": name})


def checklist(profiles: dict, cases: list[dict]) -> str:
    done = {c["person"] for c in cases}
    lines = [
        "# Conferência de processos criminais (privado, fora do git)",
        "",
        "Para cada pessoa: abrir a busca do STF pelo nome, conferir cada processo na página do",
        "próprio tribunal e, se houver, anotar em data/legal.yaml (grau, crime, tribunal, número,",
        "data, link oficial, data da conferência). Homônimos: conferir o nome completo no processo.",
        "",
    ]
    for p in sorted(profiles["people"], key=lambda p: (p["office"], p["uf"], p["name"])):
        if p["office"] not in ("deputado-federal", "senador"):
            continue
        mark = "x" if p["id"] in done else " "
        name = p.get("fullName") or p["name"]
        lines.append(
            f"- [{mark}] {p['name']} ({p['party']}, {p['uf']}, {p['office']}) · `{p['id']}` · "
            f"[STF]({stf_search(name)})"
        )
    return "\n".join(lines) + "\n"


def load_cases() -> list[dict]:
    raw = yaml.safe_load(SOURCE.read_text(encoding="utf-8")) or {}
    return raw.get("cases") or []


def main() -> int:
    profiles = json.loads(PROFILES.read_text(encoding="utf-8"))
    cases = load_cases()
    today = date.today()
    try:
        warnings = validate(cases, {p["id"] for p in profiles["people"]}, today)
    except LegalError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if "--checklist" in sys.argv:
        CHECKLIST.parent.mkdir(parents=True, exist_ok=True)
        CHECKLIST.write_text(checklist(profiles, cases), encoding="utf-8")
        print(f"wrote {CHECKLIST.relative_to(DATA.parent)} (private)")
        return 0
    PROFILES.write_text(
        json.dumps(merge(profiles, cases, today), ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"{len(cases)} cases for {len({c['person'] for c in cases})} people added to {PROFILES.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
