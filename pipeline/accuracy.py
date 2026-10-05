"""How close each pollster got to the official result."""

from __future__ import annotations

from datetime import date, timedelta
from statistics import fmean

from .polls import Poll, day_of_year

# Only the last poll each pollster finished this close to election day counts.
WINDOW_DAYS = 10


def pollster_accuracy(polls: list[Poll], result: dict[str, float], election: date) -> list[dict]:
    """Ranks pollsters by the error of their final poll.

    Each poll is compared on the candidates it measured that are in the result,
    as long as it has the top two (the margin needs both): a poll that left out
    a minor name still counts. Poll and result are both rescaled to shares of
    those candidates, which puts total-vote polls and the valid-vote result on
    the same footing.
    """
    ranked = sorted(result, key=lambda c: -result[c])
    if len(ranked) < 2:
        return []
    first, second = ranked[:2]
    start = election - timedelta(days=WINDOW_DAYS)
    final: dict[str, Poll] = {}
    for p in sorted(polls, key=lambda p: p.end_date):
        if start <= p.end_date < election and first in p.values and second in p.values:
            final[p.pollster] = p

    rows = []
    for pollster, p in final.items():
        candidates = [c for c in ranked if c in p.values]
        result_total = sum(result[c] for c in candidates)
        poll_total = sum(p.values[c] for c in candidates)
        truth = {c: result[c] / result_total * 100 for c in candidates}
        share = {c: p.values[c] / poll_total * 100 for c in candidates}
        rows.append(
            {
                "p": pollster,
                "d": day_of_year(p.end_date, election.year),
                "meanError": round(fmean(abs(share[c] - truth[c]) for c in candidates), 2),
                "marginError": round(abs(share[first] - share[second] - (truth[first] - truth[second])), 2),
                "shares": {c: round(share[c], 1) for c in candidates},
            }
        )
    return sorted(rows, key=lambda r: (r["meanError"], r["p"]))
