"""How close each pollster got to the official result."""

from __future__ import annotations

from datetime import date, timedelta
from statistics import fmean

from .polls import Poll, day_of_year

# Only the last poll each pollster finished this close to election day counts.
WINDOW_DAYS = 10


def pollster_accuracy(polls: list[Poll], result: dict[str, float], election: date) -> list[dict]:
    """Ranks pollsters by the error of their final poll.

    Poll and result are both rescaled to shares of the candidates in the result,
    which puts total-vote polls and the valid-vote result on the same footing.
    """
    candidates = [c for c in result if any(c in p.values for p in polls)]
    if not candidates:
        return []
    start = election - timedelta(days=WINDOW_DAYS)
    final: dict[str, Poll] = {}
    for p in sorted(polls, key=lambda p: p.end_date):
        if start <= p.end_date < election and all(c in p.values for c in candidates):
            final[p.pollster] = p

    result_total = sum(result[c] for c in candidates)
    result_share = {c: result[c] / result_total * 100 for c in candidates}
    first, second = sorted(candidates, key=lambda c: -result[c])[:2]
    result_margin = result_share[first] - result_share[second]

    rows = []
    for pollster, p in final.items():
        poll_total = sum(p.values[c] for c in candidates)
        share = {c: p.values[c] / poll_total * 100 for c in candidates}
        rows.append(
            {
                "p": pollster,
                "d": day_of_year(p.end_date, election.year),
                "meanError": round(fmean(abs(share[c] - result_share[c]) for c in candidates), 2),
                "marginError": round(abs(share[first] - share[second] - result_margin), 2),
                "shares": {c: round(share[c], 1) for c in candidates},
            }
        )
    return sorted(rows, key=lambda r: (r["meanError"], r["p"]))
