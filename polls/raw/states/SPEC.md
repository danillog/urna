# Output spec: one JSON file per state at /home/claude/polls/raw/states/<UF>.json

{
  "uf": "SP",
  "state": "São Paulo",
  "gov_t1": {
    "candidates": {"Tarcísio": "Republicanos", "Haddad": "PT"},
    "polls": [
      {"p": "Quaest", "date": "2026-09-20", "n": 1500, "method": "presencial|telefone|online|", "v": {"Tarcísio": 45, "Haddad": 30, "Outros": 8, "BNI": 17}}
    ]
  },
  "gov_t2": {
    "matchup": ["Tarcísio", "Haddad"],
    "candidates": {"Tarcísio": "Republicanos", "Haddad": "PT"},
    "polls": [ {"p": "...", "date": "...", "n": 1500, "v": {"Tarcísio": 50, "Haddad": 38, "BNI": 12}} ]
  },
  "sen_t1": {
    "candidates": {"Name": "PARTY"},
    "note": "how the source reports the senate vote (e.g. '1st vote', 'sum of two votes', 'single choice')",
    "polls": [ ... same shape ... ]
  },
  "notes": "anything the maintainer should know (scenario choices, gaps, doubts)",
  "sources": ["https://..."]
}

Rules
- Only polls with fieldwork ENDING between 2026-01-01 and 2026-09-29. Drop anything from 2025 or earlier.
- "date" = last day of fieldwork (YYYY-MM-DD). "n" = sample size (integer) or null.
- Values are percentages of TOTAL votes (stimulated/estimulada scenario). If a source only gives valid votes (votos válidos), DO NOT include that first-round row (you may include its second-round row if that one is in total votes).
- "BNI" = brancos + nulos + indecisos/não sabem/não responderam summed. Omit the key if not available.
- "Outros" = sum of every other listed candidate not in "candidates" (optional).
- Keep at most 6 named candidates per office: those who are real/likely candidates in September 2026 (registered with TSE if you can tell). A candidate who withdrew or was never in the race should not be kept; if a poll's main scenario includes someone who left, prefer the scenario closest to the final field; if none, skip that poll.
- One row per poll (per institute + date). If a poll has several scenarios, use the scenario that matches the final September field most closely.
- Use the short name voters know (e.g. "Tarcísio", "Haddad", "Eduardo Paes"). Use the SAME spelling in every row and in "candidates". Party = party abbreviation.
- gov_t2: only the single most-polled second-round matchup (normally the two leaders). Omit gov_t2 entirely if there are fewer than 3 such polls. If the governor race looks likely to end in the 1st round, still include gov_t2 if polls exist.
- Senate: 2026 elects 2 senators per state. Polls usually report either the 1st vote or the sum of both votes. Pick ONE convention per state, use it for every row, and describe it in sen_t1.note.
- Pollster names: use the institute name only (e.g. "Quaest", "Datafolha", "AtlasIntel", "Real Time Big Data", "Paraná Pesquisas", "Ipec", "Futura", "Nexus", "PoderData", "Gerp", "Vox Brasil", "Ideia", "MDA", "Instituto Veritá", local institutes by their own name). Drop the media partner ("Genial/Quaest" -> "Quaest", "Nexus/BTG" -> "Nexus").
- "method": fill only if the source states how interviews were done; otherwise "".
- Never invent or estimate a number. If unsure about a row, leave it out and mention it in "notes".
- If a state has fewer than 3 polls for an office, still write what you found (the maintainer will decide).
- Validate the file with: python3 -c "import json;json.load(open('/home/claude/polls/raw/states/<UF>.json'))"
