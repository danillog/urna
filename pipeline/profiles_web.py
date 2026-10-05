"""Adds to data/generated/profiles.json what the TSE does not have: appointed offices,
social networks, the Wikipedia article and recent news.

    uv run python -m pipeline.profiles_web            # after pipeline.profiles
    uv run python -m pipeline.profiles_web --no-news  # Wikidata only

Wikidata (query.wikidata.org): each person is looked up by name (ballot name or full
name, labels and aliases in Portuguese), among Brazilians, and accepted only when the
date of birth agrees with the TSE's (same day and month, the year within one: the two
sources sometimes differ by a year). No match, or two, means nothing is added. From
the match: public offices held with their dates (ministers, secretaries… which the TSE
does not record, as they are not elected), official website, Instagram, X, Facebook,
YouTube, TikTok and Bluesky accounts, and the Portuguese Wikipedia article.

News (Google News RSS): the most recent headlines for the person's name in quotes and
office, with outlet, date and link. An automatic search: it can bring namesakes, and
says so on the page.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime

from .profiles import OUTPUT, PRIVATE, plain
from .sources.http import get

SPARQL = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"
NEWS = "https://news.google.com/rss/search"
BATCH = 60
NEWS_PER_PERSON = 3
# Google News links are long; only the article's id is kept, the page adds this back.
NEWS_ARTICLE = "https://news.google.com/rss/articles/"

# Offices that count as public posts for the "appointed" kind; the rest (a company's
# director, a club's president) are listed but do not make someone a politician.
PUBLIC = re.compile(
    r"ministr|secretári|secretari|prefeit|vereador|deputad|senador|governador|presidente da rep|"
    r"vice-|conselheir|chefe d|administrador regional|subprefeit|embaixador|procurador|defensor|"
    r"juiz|desembargador|ouvidor|superintendente|diretor[a]? d[aoe] (agência|banco|instituto nacional)",
    re.IGNORECASE,
)
SOCIAL = {
    "P2003": ("Instagram", "https://www.instagram.com/{}"),
    "P2002": ("X", "https://x.com/{}"),
    "P2013": ("Facebook", "https://www.facebook.com/{}"),
    "P2397": ("YouTube", "https://www.youtube.com/channel/{}"),
    "P7085": ("TikTok", "https://www.tiktok.com/@{}"),
    "P12361": ("Bluesky", "https://bsky.app/profile/{}"),
}
OFFICE_WORDS = {
    "governador": "governador OR governadora",
    "senador": "senador OR senadora",
    "deputado-federal": "deputado OR deputada",
}


def sparql(query: str) -> list[dict]:
    for attempt in range(4):
        try:
            body = get(f"{SPARQL}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}")
            return [{k: v["value"] for k, v in b.items()} for b in json.loads(body)["results"]["bindings"]]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    return []


def literal(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"@pt'


def same_person(tse_birth: str | None, wd_birth: str | None) -> bool:
    """Birthdays that agree but for one part: the TSE and Wikidata disagree now and then by a
    year (Anielle Franco) or a month (Tarcísio de Freitas). A year apart counts as one part;
    more than a year, as a different person."""
    if not tse_birth or not wd_birth:
        return False
    (ya, ma, da), (yb, mb, db) = (map(int, x[:10].split("-")) for x in (tse_birth, wd_birth))
    if abs(ya - yb) > 1:
        return False
    return (ya != yb) + (ma != mb) + (da != db) <= 1


def find_items(people: list[dict], private: dict) -> dict[str, str]:
    """Person id → Wikidata item, where exactly one Brazilian with the name and birthday exists."""
    names: dict[str, set[str]] = {}
    for p in people:
        info = private.get(p["id"], {})
        forms = {p["name"], p["fullName"]}
        if info.get("fullName"):
            forms.add(info["fullName"].title())
        names[p["id"]] = {f for f in forms if f}
    wanted = sorted({n for ns in names.values() for n in ns})
    found: dict[str, list[tuple[str, str]]] = {}  # plain name → [(item, birth)]
    for i in range(0, len(wanted), BATCH):
        chunk = wanted[i : i + BATCH]
        q = f"""
        SELECT ?item ?name ?birth WHERE {{
          VALUES ?name {{ {" ".join(literal(n) for n in chunk)} }}
          ?item rdfs:label|skos:altLabel ?name; wdt:P27 wd:Q155; wdt:P569 ?birth.
        }}"""
        for r in sparql(q):
            found.setdefault(plain(r["name"]), []).append((r["item"].rsplit("/", 1)[-1], r["birth"]))
        time.sleep(1)
    out = {}
    for p in people:
        born = private.get(p["id"], {}).get("born")
        items = {
            item
            for n in names[p["id"]]
            for item, birth in found.get(plain(n), [])
            if same_person(born, birth)
        }
        if len(items) == 1:
            out[p["id"]] = items.pop()
    return out


def search_items(people: list[dict], private: dict, found: dict[str, str]) -> dict[str, str]:
    """For people not matched by exact name: Wikidata's text search on each name form,
    the hits then held to the same birthday check."""
    out: dict[str, str] = {}
    for p in people:
        if p["id"] in found:
            continue
        info = private.get(p["id"], {})
        hits: set[str] = set()
        for name in {p["name"], (info.get("fullName") or "").title()} - {""}:
            q = urllib.parse.urlencode(
                {
                    "action": "wbsearchentities",
                    "search": name,
                    "language": "pt",
                    "limit": 10,
                    "format": "json",
                }
            )
            try:
                hits |= {h["id"] for h in json.loads(get(f"{API}?{q}")).get("search", [])}
            except Exception:
                continue
            time.sleep(0.2)
        if not hits:
            continue
        rows = sparql(f"""
        SELECT ?item ?birth WHERE {{
          VALUES ?item {{ {" ".join(f"wd:{h}" for h in hits)} }}
          ?item wdt:P27 wd:Q155; wdt:P569 ?birth.
        }}""")
        matched = {r["item"].rsplit("/", 1)[-1] for r in rows if same_person(info.get("born"), r["birth"])}
        if len(matched) == 1:
            out[p["id"]] = matched.pop()
    return out


def year(v: str | None) -> int | None:
    return int(v[:4]) if v and re.match(r"\d{4}", v) else None


def details(items: list[str]) -> dict[str, dict]:
    """Item → offices held, accounts, website and Wikipedia article."""
    out: dict[str, dict] = {
        i: {"positions": [], "socials": [], "site": None, "wikipedia": None} for i in items
    }
    for i in range(0, len(items), BATCH):
        values = " ".join(f"wd:{x}" for x in items[i : i + BATCH])
        positions = sparql(f"""
        SELECT ?item ?posLabel ?start ?end WHERE {{
          VALUES ?item {{ {values} }}
          ?item p:P39 ?st. ?st ps:P39 ?pos.
          OPTIONAL {{ ?st pq:P580 ?start }} OPTIONAL {{ ?st pq:P582 ?end }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "pt,en". }}
        }}""")
        for r in positions:
            item = r["item"].rsplit("/", 1)[-1]
            label = r.get("posLabel", "")
            if re.fullmatch(r"Q\d+", label):  # no Portuguese or English label
                continue
            out[item]["positions"].append(
                {"title": label, "from": year(r.get("start")), "to": year(r.get("end"))}
            )
        props = " ".join(f"OPTIONAL {{ ?item wdt:{p} ?{p} }}" for p in [*SOCIAL, "P856"])
        accounts = sparql(f"""
        SELECT ?item ?article {" ".join("?" + p for p in [*SOCIAL, "P856"])} WHERE {{
          VALUES ?item {{ {values} }}
          {props}
          OPTIONAL {{ ?article schema:about ?item; schema:isPartOf <https://pt.wikipedia.org/> }}
        }}""")
        for r in accounts:
            item = r["item"].rsplit("/", 1)[-1]
            o = out[item]
            o["wikipedia"] = o["wikipedia"] or r.get("article")
            o["site"] = o["site"] or r.get("P856")
            for prop, (network, url) in SOCIAL.items():
                handle = r.get(prop)
                link = url.format(handle) if handle else None
                if link and all(s["url"] != link for s in o["socials"]):
                    o["socials"].append({"network": network, "url": link})
        time.sleep(1)
    for o in out.values():
        # One line per office and start year; most recent first.
        seen, unique = set(), []
        for pos in sorted(o["positions"], key=lambda x: -(x["from"] or 0)):
            key = (pos["title"], pos["from"])
            if key not in seen:
                seen.add(key)
                unique.append(pos)
        o["positions"] = unique
    return out


def news(p: dict) -> list[dict]:
    """The latest headlines for a person: name in quotes and office, newest first."""
    q = f'"{p["name"]}" ({OFFICE_WORDS[p["office"]]} OR eleito OR eleita)'
    url = f"{NEWS}?{urllib.parse.urlencode({'q': q, 'hl': 'pt-BR', 'gl': 'BR', 'ceid': 'BR:pt-419'})}"
    try:
        root = ET.fromstring(get(url))
    except Exception as e:
        print(f"    news {p['id']}: {type(e).__name__}", file=sys.stderr)
        return []
    items = []
    for it in root.iter("item"):
        source = it.findtext("source") or ""
        title = (it.findtext("title") or "").removesuffix(f" - {source}").strip()
        try:
            when = parsedate_to_datetime(it.findtext("pubDate") or "").date().isoformat()
        except (TypeError, ValueError):
            continue
        link = it.findtext("link") or ""
        if not link.startswith(NEWS_ARTICLE):
            continue
        items.append(
            {"title": title, "source": source, "date": when, "id": link[len(NEWS_ARTICLE) :].split("?")[0]}
        )
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:NEWS_PER_PERSON]


# The office someone holds or was just elected to does not make them "appointed".
OWN_OFFICE = {"governador": "governador", "senador": "senador", "deputado-federal": "deputado federal"}
# Offices one is elected to: they count as a career at the polls, not as an appointment.
ELECTIVE = re.compile(
    r"senador|deputad|vereador|prefeit|governador|vice-prefeit|vice-governador|presidente da rep",
    re.IGNORECASE,
)


def appointed(p: dict) -> bool:
    """Never elected (TSE since 2010) but held an appointed public office (Wikidata):
    minister, secretary, ambassador…"""
    return p["kind"] in ("new", "tried") and any(
        PUBLIC.search(x["title"]) and not ELECTIVE.search(x["title"]) for x in p.get("positions", [])
    )


def elected_before(p: dict) -> str | None:
    """'returning' or 'other-office' when Wikidata shows an elected office the TSE files
    (from 2010) miss: a senator of 2003–2011, a mayor of the 2000s. The mandate the person
    holds now (started 2023 or later) is not "before"."""
    own = OWN_OFFICE[p["office"]]
    past = [x for x in p.get("positions", []) if ELECTIVE.search(x["title"]) and (x["from"] or 0) < 2023]
    if any(own in x["title"].lower() for x in past):
        return "returning"
    return "other-office" if past else None


def main() -> int:
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    private = json.loads(PRIVATE.read_text(encoding="utf-8"))
    people = data["people"]
    print("Wikidata: finding people…", flush=True)
    items = find_items(people, private)
    print(f"  {len(items)} of {len(people)} found by name; searching the rest…", flush=True)
    items |= search_items(people, private, items)
    print(f"  {len(items)} of {len(people)} found", flush=True)
    info = details(sorted(set(items.values())))
    for p in people:
        w = info.get(items.get(p["id"], ""), None)
        p["positions"] = w["positions"] if w else []
        p["wikipedia"] = w["wikipedia"] if w else None
        p["wikidata"] = items.get(p["id"])
        if w:
            contact = p.get("contact")
            # The Congress's own list comes first; Wikidata fills what it lacks.
            own = contact["socials"] if contact else []
            p["socials"] = own + [s for s in w["socials"] if all(s["network"] != o["network"] for o in own)]
            p["site"] = (contact or {}).get("site") or w["site"]
        else:
            p["socials"] = (p.get("contact") or {}).get("socials", [])
            p["site"] = (p.get("contact") or {}).get("site")
        if p["kind"] in ("new", "tried"):
            p["kind"] = elected_before(p) or ("appointed" if appointed(p) else p["kind"])
    if "--no-news" not in sys.argv:
        print("news…", flush=True)
        for k, p in enumerate(people):
            p["news"] = news(p)
            time.sleep(0.4)
            if k % 100 == 99:
                print(f"  {k + 1} people", flush=True)
        data["newsUpdated"] = datetime.now(UTC).date().isoformat()
    data["webSources"] = date.today().isoformat()
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with_positions = sum(1 for p in people if p["positions"])
    with_socials = sum(1 for p in people if p["socials"])
    print(
        f"  {len(items)} on Wikidata, {with_positions} with offices, {with_socials} with social networks, "
        f"{sum(1 for p in people if p['kind'] == 'appointed')} appointed"
    )
    print(f"wrote {OUTPUT.relative_to(OUTPUT.parents[2])} ({OUTPUT.stat().st_size / 1e3:,.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
