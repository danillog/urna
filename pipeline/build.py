"""Builds data/generated/elections.json from the sources in data/.

uv run python -m pipeline.build           # write the dataset
uv run python -m pipeline.build --check   # fail if the committed dataset is stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from . import results
from .polls import DataError
from .pollsters import PollsterRegistry
from .presidential import build_presidential
from .states import build_states

DATA = Path(__file__).resolve().parent.parent / "data"
OUTPUT = DATA / "generated" / "elections.json"


def load_yaml(name: str) -> dict:
    return yaml.safe_load((DATA / name).read_text(encoding="utf-8"))


def build_dataset() -> dict:
    pollsters = PollsterRegistry.load(DATA / "pollsters.yaml")
    elections = load_yaml("elections.yaml")
    states_config = load_yaml("states.yaml")
    state_year = str(states_config["year"])
    round_dates = {r: spec["date"] for r, spec in elections[state_year]["rounds"].items()}
    return {
        "methods": pollsters.methods(),
        "presidential": build_presidential(elections, DATA / "raw" / "presidential", pollsters),
        "states": build_states(
            states_config,
            DATA / "raw" / "states",
            round_dates,
            pollsters,
            results.load(states_config["year"], "r1"),
        ),
    }


def serialize(dataset: dict) -> str:
    return json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n"


def summary(dataset: dict) -> str:
    lines = []
    for year, election in dataset["presidential"].items():
        for round_id, race in election["rounds"].items():
            polls, pollsters = len(race["polls"]), len({p["p"] for p in race["polls"]})
            lines.append(f"  president {year} {round_id}: {polls:>3} polls, {pollsters} pollsters")
    states = dataset["states"].values()
    races = sum(len(s["governor"]) + len(s["senate"]) for s in states)
    polls = sum(len(r["polls"]) for s in states for o in ("governor", "senate") for r in s[o].values())
    lines.append(f"  states: {len(dataset['states'])} UFs, {races} races, {polls} polls")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--check", action="store_true", help="verify the committed dataset is up to date")
    args = parser.parse_args()
    try:
        dataset = build_dataset()
    except DataError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    text = serialize(dataset)
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
            print("error: data/generated/elections.json is stale; run `npm run data`", file=sys.stderr)
            return 1
        print("dataset is up to date")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({len(text.encode()) / 1024:.0f} KB)")
    print(summary(dataset))
    return 0


if __name__ == "__main__":
    sys.exit(main())
