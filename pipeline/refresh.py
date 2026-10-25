"""Runs every data pipeline that has something new to read, in the right order.

    npm run refresh              # the light steps: what a scheduled run can do
    npm run refresh -- --all     # also the heavy ones, which need this machine's caches
    npm run refresh -- --dry-run # list the steps

Light steps read only public, small sources and the committed datasets: the official
results (both rounds), the count per municipality, the 2026 delegations in Congress, the
profiles' news, and the polls' dataset (which picks up the results). Heavy steps download
gigabytes or read the private profile index kept in data/raw/ (not in git): the map, the
profiles, the census crossing and the capitals.

A step waiting on the TSE (the runoff before it is listed) is reported as waiting, not as
a failure. The run fails only when a step fails for another reason; the others still run.
"""

from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Step:
    name: str
    module: str
    args: tuple[str, ...] = ()
    heavy: bool = False


STEPS = [
    Step("official results, 1st round", "pipeline.results", ("r1",)),
    Step("official results, runoff", "pipeline.results", ("r2",)),
    Step("count per municipality, 1st round", "pipeline.apuracao_cidades", ("r1",)),
    Step("count per municipality, runoff", "pipeline.apuracao_cidades", ("r2",)),
    Step("2026 delegations in Congress", "pipeline.congress", ("--refresh-2026",)),
    Step("Congress today: parties now and who switched", "pipeline.congress", ("--refresh-now",), heavy=True),
    Step("Alesp and São Paulo's city council", "pipeline.congress", ("--refresh-sp",), heavy=True),
    Step("map: 2026 results by municipality", "pipeline.fetch_tse_results", ("2026",), heavy=True),
    Step("map", "pipeline.municipal_map", heavy=True),
    Step("profiles of the elected", "pipeline.profiles", heavy=True),
    Step("profiles: Wikidata and news", "pipeline.profiles_web", heavy=True),
    Step("profiles: news", "pipeline.profiles_web", ("--news-only",)),
    Step("profiles: criminal cases checked by hand", "pipeline.legal"),
    Step("profiles: the current term in Congress", "pipeline.mandate", heavy=True),
    Step("Congress: each member by their votes", "pipeline.ideology", heavy=True),
    Step("De olho: allowance spent and attendance, four houses", "pipeline.watch", heavy=True),
    Step("Congress again, with the profiles' newcomers", "pipeline.congress"),
    Step("census and vote", "pipeline.census_vote", heavy=True),
    Step("capitals, 1st round", "pipeline.capitals", heavy=True),
    Step("capitals, runoff", "pipeline.capitals", ("r2",), heavy=True),
    Step("polls dataset", "pipeline.build"),
]

WAITING = "has not published"


def plan(all_steps: bool) -> list[Step]:
    steps = [s for s in STEPS if all_steps or not s.heavy]
    # With the full profiles step, its news come along: no separate news-only run.
    if all_steps:
        steps = [s for s in steps if s.args != ("--news-only",)]
    return steps


def main() -> int:
    args = sys.argv[1:]
    steps = plan("--all" in args)
    if "--dry-run" in args:
        for s in steps:
            print(f"{s.name}: python -m {s.module} {' '.join(s.args)}".rstrip())
        return 0
    report: list[tuple[str, str, float]] = []
    for s in steps:
        print(f"\n== {s.name}", flush=True)
        start = time.monotonic()
        run = subprocess.run([sys.executable, "-m", s.module, *s.args], capture_output=True, text=True)
        sys.stdout.write(run.stdout)
        sys.stderr.write(run.stderr)
        status = "ok" if run.returncode == 0 else "waiting" if WAITING in run.stderr else "FAILED"
        report.append((s.name, status, time.monotonic() - start))
    print("\nsummary:")
    for name, status, seconds in report:
        print(f"  {status:8s} {name} ({seconds:,.0f}s)")
    return 1 if any(status == "FAILED" for _, status, _ in report) else 0


if __name__ == "__main__":
    sys.exit(main())
