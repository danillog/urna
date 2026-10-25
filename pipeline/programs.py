"""The runoff candidates' government programs as cards, from data/programs.yaml: written by
hand, checked here against the PDFs each candidate registered with the TSE. Writes
data/generated/programs.json for the "Programas" tab.

    uv run python -m pipeline.programs

The tab turns the cards into a quiz ("which program do you agree with more?"), so the
cards decide the result. Nothing here chooses or words a card; this only refuses a file
that breaks the rules written at the top of data/programs.yaml:

- Every quote must be on the page it cites, word for word: the PDF's text is read with
  pdftotext (poppler-utils), and spacing, line breaks, dashes and quotation marks do not
  count. A card that says something its quotes do not is a person's mistake to catch;
  a quote that is not in the program is caught here.
- The PDFs in public/programas/ must be the TSE's (their SHA-256 is in the YAML).
- Each theme has as many cards for one candidate as for the other, and no count of cards
  is a candidate's ballot number.
- Each candidate lists the same networks, and when the TSE's files are in data/raw/profiles/
  (kept by pipeline.profiles), every link must be one the candidate declared, and number,
  party and vice must match the candidacy.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import subprocess
import sys
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path

import yaml

from .build import DATA

SOURCE = DATA / "programs.yaml"
OUTPUT = DATA / "generated" / "programs.json"
PUBLIC = DATA.parent / "public"
PROFILES_CACHE = DATA / "raw" / "profiles"
CHANNELS = ("site", "instagram", "x", "youtube", "tiktok", "facebook")
CANDIDATE_FIELDS = ("id", "number", "name", "fullName", "party", "coalition", "vice", "pdf")
CARD_FIELDS = ("id", "theme", "candidate", "text", "sources")
# What the reader sees on a card: one sentence, short enough for a phone screen.
MAX_TEXT = 180


class ProgramError(ValueError):
    pass


def normalize(text: str) -> str:
    """The text as compared: one space between words, plain dashes and quotes, any case."""
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[‐-―−]", "-", text)
    text = re.sub(r"[“”„‟″]", '"', text)
    text = re.sub(r"[‘’‚‛′]", "'", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def pdf_pages(path: Path) -> list[str]:
    """Each page's text, first page first (pdftotext puts a form feed between pages)."""
    out = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, check=True, text=True).stdout
    pages = out.split("\f")
    return pages[:-1] if pages and not pages[-1].strip() else pages


def check_sources(where: str, sources: list[dict], pages: list[str]) -> None:
    if not sources:
        raise ProgramError(f"{where}: no source")
    for s in sources:
        page, quote = s.get("page"), str(s.get("quote") or "")
        if not isinstance(page, int) or not 1 <= page <= len(pages):
            raise ProgramError(f"{where}: page {page!r} is not in the PDF (1–{len(pages)})")
        if len(quote) < 15:
            raise ProgramError(f"{where}: quote too short to identify a passage: {quote!r}")
        if normalize(quote) not in normalize(pages[page - 1]):
            raise ProgramError(f"{where}: not on page {page}: {quote!r}")


def validate(program: dict, pages: dict[str, list[str]]) -> None:
    """Raises ProgramError on the first rule broken. `pages`: each candidate's PDF text."""
    candidates = program.get("candidates") or []
    ids = [c["id"] for c in candidates]
    if len(ids) != 2 or len(set(ids)) != 2:
        raise ProgramError("candidates: exactly two, each with its own id")
    networks = {c["id"]: set(c.get("channels") or {}) for c in candidates}
    for c in candidates:
        extra = networks[c["id"]] - set(CHANNELS)
        if extra:
            allowed = ", ".join(CHANNELS)
            raise ProgramError(f"candidate {c['id']}: channels must be among {allowed}, not {extra}")
    if networks[ids[0]] != networks[ids[1]]:
        raise ProgramError("channels: both candidates list the same networks")

    themes = [t["id"] for t in program.get("themes") or []]
    if len(set(themes)) != len(themes):
        raise ProgramError("themes: repeated id")
    seen: set[str] = set()
    per_theme: dict[str, Counter] = {t: Counter() for t in themes}
    for card in program.get("cards") or []:
        where = f"card {card.get('id')!r}"
        if not card.get("id") or card["id"] in seen:
            raise ProgramError(f"{where}: missing or repeated id")
        seen.add(card["id"])
        if card.get("theme") not in per_theme:
            raise ProgramError(f"{where}: no theme {card.get('theme')!r}")
        if card.get("candidate") not in ids:
            raise ProgramError(f"{where}: no candidate {card.get('candidate')!r}")
        text = str(card.get("text") or "")
        if not text or len(text) > MAX_TEXT:
            raise ProgramError(f"{where}: text must have 1 to {MAX_TEXT} characters ({len(text)})")
        check_sources(where, card.get("sources") or [], pages[card["candidate"]])
        per_theme[card["theme"]][card["candidate"]] += 1
    for theme, counts in per_theme.items():
        if not counts:
            raise ProgramError(f"theme {theme!r}: no card")
        if counts[ids[0]] != counts[ids[1]]:
            raise ProgramError(
                f"theme {theme!r}: {counts[ids[0]]} cards for {ids[0]}, "
                f"{counts[ids[1]]} for {ids[1]}: must be equal"
            )

    numbers = {int(c["number"]) for c in candidates if c.get("number") is not None}
    per_candidate = Counter(card["candidate"] for card in program.get("cards") or [])
    for count in {sum(per_candidate.values()), *per_candidate.values()}:
        if count in numbers:
            raise ProgramError(f"{count} cards is a candidate's ballot number: add or drop a pair")

    for item in program.get("agree") or []:
        where = f"agree {item.get('id')!r}"
        if not item.get("text"):
            raise ProgramError(f"{where}: no text")
        sources = item.get("sources") or {}
        if set(sources) != set(ids):
            raise ProgramError(f"{where}: needs a source in each program")
        for cid in ids:
            check_sources(f"{where}, {cid}", sources[cid], pages[cid])


TIME = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")
# Only the broadcasters' own uploads: a clip re-cut by someone else can drop the context.
OFFICIAL_VIDEO = re.compile(r"^https://www\.youtube\.com/watch\?v=[\w-]{11}$")


def seconds(time: str) -> int:
    """'1:13:18' → 4398; '38:04' → 2284."""
    m = TIME.match(str(time))
    if not m:
        raise ProgramError(f"time {time!r} must be h:mm:ss or mm:ss")
    h, mm, ss = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
    return h * 3600 + mm * 60 + ss


def validate_debates(program: dict) -> None:
    """Promises made in a debate, apart from the programs: the same rules of balance, plus the
    minute of the official video. The quote is checked by a person against the video."""
    ids = [c["id"] for c in program["candidates"]]
    themes = {t["id"] for t in program.get("debateThemes") or []}
    debates = {d["id"]: d for d in program.get("debates") or []}
    for d in debates.values():
        if not OFFICIAL_VIDEO.match(str(d.get("video") or "")):
            raise ProgramError(
                f"debate {d['id']!r}: video must be a youtube.com/watch link to the official upload"
            )
    per_theme: dict[tuple[str, str], Counter] = {}
    seen = set()
    for p in program.get("promises") or []:
        where = f"promise {p.get('id')!r}"
        if not p.get("id") or p["id"] in seen:
            raise ProgramError(f"{where}: missing or repeated id")
        seen.add(p["id"])
        if p.get("debate") not in debates:
            raise ProgramError(f"{where}: no debate {p.get('debate')!r}")
        if p.get("theme") not in themes:
            raise ProgramError(f"{where}: no debate theme {p.get('theme')!r}")
        if p.get("candidate") not in ids:
            raise ProgramError(f"{where}: no candidate {p.get('candidate')!r}")
        seconds(p.get("time"))
        if not p.get("text") or len(p["text"]) > MAX_TEXT:
            raise ProgramError(f"{where}: text must have 1 to {MAX_TEXT} characters")
        if len(str(p.get("quote") or "")) < 15:
            raise ProgramError(f"{where}: needs the words as said")
        per_theme.setdefault((p["debate"], p["theme"]), Counter())[p["candidate"]] += 1
    for (debate, theme), counts in per_theme.items():
        if counts[ids[0]] != counts[ids[1]]:
            raise ProgramError(
                f"debate {debate!r}, theme {theme!r}: {counts[ids[0]]} promises for {ids[0]}, "
                f"{counts[ids[1]]} for {ids[1]}: must be equal"
            )


def link_key(url: str) -> str:
    """A link as the TSE's file may spell it: any case, with or without scheme, www, query or slash."""
    url = re.sub(r"^https?://", "", url.strip().casefold())
    url = re.sub(r"^(www\.|m\.|mobile\.)", "", url)
    return url.split("?")[0].rstrip("/")


def tse_rows(name: str, csv_name: str) -> list[dict] | None:
    path = PROFILES_CACHE / name
    if not path.exists():
        return None
    with zipfile.ZipFile(path) as z, z.open(csv_name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";"))


def check_against_tse(program: dict) -> list[str]:
    """Checks the candidacies and links against the TSE's files when they are cached; says what it skipped."""
    notes = []
    socials = tse_rows("rede_social_candidato_2026.zip", "rede_social_candidato_2026_BR.csv")
    if socials is None:
        notes.append("TSE social networks file not cached: links not checked")
    else:
        for c in program["candidates"]:
            declared = {link_key(r["DS_URL"]) for r in socials if r["SQ_CANDIDATO"] == c["sq"]}
            for network, url in c["channels"].items():
                if link_key(url) not in declared:
                    raise ProgramError(
                        f"candidate {c['id']}: {network} {url} is not among the links declared to the TSE"
                    )
    cands = tse_rows("consulta_cand_2026.zip", "consulta_cand_2026_BR.csv")
    if cands is None:
        notes.append("TSE candidates file not cached: candidacies not checked")
    else:
        for c in program["candidates"]:
            mine = [r for r in cands if r["NR_CANDIDATO"] == str(c["number"])]
            head = next((r for r in mine if r["SQ_CANDIDATO"] == c["sq"]), None)
            vice = next((r for r in mine if r["DS_CARGO"] == "VICE-PRESIDENTE"), None)
            if not head or head["SG_PARTIDO"] != c["party"]:
                raise ProgramError(f"candidate {c['id']}: number, sq or party differ from the TSE's")
            if not vice or normalize(vice["NM_URNA_CANDIDATO"]) not in normalize(c["vice"]):
                raise ProgramError(f"candidate {c['id']}: vice differs from the TSE's")
    return notes


def build(program: dict, pages: dict[str, list[str]]) -> dict:
    """The tab's data: what the page shows, with each PDF's page count for the links."""
    return {
        "source": {k: str(v) for k, v in program["source"].items()},
        "candidates": [
            {
                **{k: c[k] for k in CANDIDATE_FIELDS},
                "pages": len(pages[c["id"]]),
                "channels": c["channels"],
            }
            for c in program["candidates"]
        ],
        "themes": program["themes"],
        "cards": [{k: card[k] for k in CARD_FIELDS} for card in program["cards"]],
        "agree": program.get("agree") or [],
        "debates": [{**d, "date": str(d["date"])} for d in program.get("debates") or []],
        "debateThemes": program.get("debateThemes") or [],
        "promises": [{**p, "seconds": seconds(p["time"])} for p in program.get("promises") or []],
    }


def main() -> int:
    program = yaml.safe_load(SOURCE.read_text(encoding="utf-8"))
    pages = {}
    for c in program["candidates"]:
        pdf = PUBLIC / c["pdf"]
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if digest != c["sha256"]:
            print(f"error: {pdf.name} is not the TSE's file (sha256 {digest})", file=sys.stderr)
            return 1
        pages[c["id"]] = pdf_pages(pdf)
    try:
        validate(program, pages)
        validate_debates(program)
        notes = check_against_tse(program)
    except ProgramError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    for note in notes:
        print(f"note: {note}", file=sys.stderr)
    OUTPUT.write_text(
        json.dumps(build(program, pages), ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    cards = Counter(card["candidate"] for card in program["cards"])
    by_candidate = ", ".join(f"{k} {v}" for k, v in cards.items())
    print(f"{sum(cards.values())} cards ({by_candidate}) written to {OUTPUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
