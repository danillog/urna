# State poll files

One JSON file per state, `<UF>.json`, with the governor and Senate polls for 2026.
`pipeline/states.py` reads them; window, exclusions and colors live in `data/states.yaml`.

```jsonc
{
  "uf": "SP",
  "state": "São Paulo",
  "governor_r1": {
    "candidates": {"Tarcísio": "Republicanos", "Haddad": "PT"},
    "polls": [
      {"p": "Quaest", "date": "2026-09-20", "n": 1500, "method": "in_person",
       "v": {"Tarcísio": 45, "Haddad": 30, "others": 8, "undecided": 17}}
    ]
  },
  "governor_r2": {
    "matchup": ["Tarcísio", "Haddad"],
    "candidates": {"Tarcísio": "Republicanos", "Haddad": "PT"},
    "polls": [{"p": "Quaest", "date": "2026-09-20", "n": 1500, "v": {"Tarcísio": 50, "Haddad": 38, "undecided": 12}}]
  },
  "senate_r1": {
    "candidates": {"Name": "PARTY"},
    "note": "how the source reports the Senate vote",
    "polls": []
  },
  "notes": "anything the maintainer should know (scenario choices, gaps, doubts)",
  "sources": ["https://..."]
}
```

One poll per line keeps diffs readable.

## Fields

| Field | Meaning |
|---|---|
| `p` | Pollster as published. Media partners are dropped (`Genial/Quaest` → `Quaest`); `data/pollsters.yaml` normalizes the rest. |
| `date` | Last day of fieldwork, `YYYY-MM-DD`. |
| `n` | Sample size, or `null`. |
| `method` | `in_person`, `phone`, `online`, or `""` when the source does not say. |
| `v` | Percentages of **total** votes in the prompted (*estimulada*) scenario. |
| `v.undecided` | Blank + null + undecided + no answer (*BNI*). Omit if not published. |
| `v.others` | Sum of every listed candidate not in `candidates`. Optional. |
| `wikipedia` | Optional, per race: `{"name on the Wikipedia page": "our name"}`, for candidates the crawler cannot match by name and party. |

## Rules

- Only polls whose fieldwork ends inside `poll_window` (`data/states.yaml`) are used.
- First-round polls published only as valid votes are left out: they are not on the same scale.
- One row per pollster and date. When a poll has several scenarios, use the one closest to the final field.
- Keep candidates who are actually running; a scenario with someone who left the race is skipped.
- Use the same short name everywhere (`Tarcísio`, `Eduardo Paes`) and the party acronym.
- `governor_r2` holds only the most-polled runoff matchup, and only with at least 3 polls.
- Senate (two seats in 2026): pick one convention per state (first vote, or both votes rescaled to 100%) and describe it in `senate_r1.note`.
- Never estimate a number. If a row is doubtful, leave it out and say so in `notes`.

`npm run data` validates every file (dates, duplicates, sums) and fails with the file and poll at fault.
