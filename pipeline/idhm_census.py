"""An estimate of the municipal HDI (IDHM) from the 2022 Census, ahead of the official one.

    uv run python -m pipeline.idhm_census

The Atlas of Human Development in Brazil (PNUD, Ipea, FJP) computes the IDHM from census
microdata. This module follows its method (Atlas 2013) with the tables IBGE publishes by
municipality instead, so some inputs are approximations:

- Income: mean household income per person (table 10295), deflated by the INPC to
  August 2010 reais, the Atlas's base. Same concept as the Atlas; exact up to deflation.
- Education: share of adults (18+) with primary school complete (table 10061), exact;
  school flow from attendance by age and level (tables 10056, 10058) and schooling of
  18–24 year-olds (10061). Census tables don't split the early and final years of primary
  school, nor give the schooling of 15–17 year-olds, so the flow is approximated.
- Longevity: the Atlas estimates it indirectly from children born alive and still alive by
  the mother's age, Brass's method. Here the share of children who died (mothers 15–39,
  table 10078), pulled toward the state's share where births are few, together with income,
  stands in for it.

The approximations are calibrated on 2010: the same calculation run on the 2010 Census
tables is fitted, component by component, to the official 2010 IDHM, and the fit is then
applied to 2022. The validation error is printed and stored with the result.
"""

from __future__ import annotations

import math
import sys

from .sources.ipea import by_territory
from .sources.sidra import values

YEAR = 2022

# INPC index numbers (IBGE table 1736): August 2010 (Atlas base) and July 2022 (Census reference).
INPC_2010_08 = 3197.82
INPC_2022_07 = 6645.74


def income_index(per_capita_2010_reais: float) -> float:
    """Atlas: log scale between R$ 8 and R$ 4,033 a month (August 2010)."""
    v = (math.log(per_capita_2010_reais) - math.log(8)) / (math.log(4033) - math.log(8))
    return min(max(v, 0.0), 1.0)


def longevity_index(life_expectancy: float) -> float:
    return min(max((life_expectancy - 25) / 60, 0.0), 1.0)


def education_index(adults: float, flow: list[float]) -> float:
    """Geometric mean, adult schooling weighing 1 and school flow 2 (Atlas)."""
    f = sum(flow) / len(flow)
    return (adults * f * f) ** (1 / 3) if adults > 0 and f > 0 else 0.0


def solve(rows: list[list[float]], ys: list[float]) -> list[float]:
    """Least squares coefficients, by the normal equations (a handful of columns)."""
    k = len(rows[0])
    a = [[sum(r[i] * r[j] for r in rows) for j in range(k)] for i in range(k)]
    b = [sum(r[i] * y for r, y in zip(rows, ys, strict=True)) for i in range(k)]
    for col in range(k):
        pivot = max(range(col, k), key=lambda r: abs(a[r][col]))
        a[col], a[pivot], b[col], b[pivot] = a[pivot], a[col], b[pivot], b[col]
        for r in range(k):
            if r != col:
                f = a[r][col] / a[col][col]
                a[r] = [x - f * y for x, y in zip(a[r], a[col], strict=True)]
                b[r] -= f * b[col]
    return [b[i] / a[i][i] for i in range(k)]


def logit(p: float) -> float:
    p = min(max(p, 1e-3), 0.5)
    return math.log(p / (1 - p))


# ---- Census tables. Keys are SIDRA category ids.

# Mothers aged 15–19 … 45–49 (classification 12232, same ids in 2010 and 2022).
MOTHERS = [104541, 104544, 104545, 104546, 104547, 104548, 104549]
# Children of mothers aged 15–39: enough births for small towns, still recent mortality.
MORTALITY_MOTHERS = MOTHERS[:5]
# Births by which a town's child mortality is pulled toward its state's (empirical Bayes):
# a town of a few hundred births says little on its own.
SHRINK_BIRTHS = 2000


def children(table: int, year: int, women: int, born: int, alive: int) -> dict[str, dict[str, list[float]]]:
    """Per municipality: women, children born alive and children alive, by mother's age."""
    cls = {12232: MOTHERS}
    w, b, s = (values(table, year, v, cls) for v in (women, born, alive))
    return {
        m: {
            "women": [w[m].get((a,), 0.0) for a in MOTHERS],
            "born": [b.get(m, {}).get((a,), 0.0) for a in MOTHERS],
            "alive": [s.get(m, {}).get((a,), 0.0) for a in MOTHERS],
        }
        for m in w
    }


def child_mortality(data: dict[str, dict[str, list[float]]]) -> dict[str, float]:
    """Share of children who died, mothers 15–39, shrunk toward the state's share; logit."""
    idx = range(len(MORTALITY_MOTHERS))
    births = {m: sum(d["born"][i] for i in idx) for m, d in data.items()}
    deaths = {m: births[m] - sum(d["alive"][i] for i in idx) for m, d in data.items()}
    state_b: dict[str, float] = {}
    state_d: dict[str, float] = {}
    for m in data:
        state_b[m[:2]] = state_b.get(m[:2], 0) + births[m]
        state_d[m[:2]] = state_d.get(m[:2], 0) + deaths[m]
    return {
        m: logit((deaths[m] + SHRINK_BIRTHS * state_d[m[:2]] / state_b[m[:2]]) / (births[m] + SHRINK_BIRTHS))
        for m in data
        if state_b[m[:2]]
    }


def _done(row: dict, ages: list[int], low: list[int], total: int, unknown: int | None) -> float | None:
    """Share of an age group past a schooling level: 1 − those in the levels below it."""
    n = sum(row.get((total, a), 0) - (row.get((unknown, a), 0) if unknown else 0) for a in ages)
    below = sum(row.get((lvl, a), 0) for lvl in low for a in ages)
    return 1 - below / n if n else None


def education_2010() -> dict[str, dict[str, float]]:
    """Education inputs from the 2010 Census, with both the exact and the proxy 15–17 indicator."""
    # Table 3540: people 10+ by schooling (classification 1568) and age (58).
    edu = values(3540, 2010, 140, {1568: "all", 58: [0, 1142, 2792, 92982, 1144]})
    # Table 3546: attending school or not, by age.
    att = values(3546, 2010, 690, {58: "all"})
    out_ = values(3546, 2010, 1922, {58: "all"})
    # Table 3545: attending school, 10+, by age and course.
    course = values(3545, 2010, 1921, {58: [118282, 2498, 92981, 92982], 11322: "all"})
    out: dict[str, dict[str, float]] = {}
    for m, row in edu.items():
        # 18+ = all ages 10+ minus 10–14 and 15–17.
        adult = {
            lvl: row.get((lvl, 0), 0) - row.get((lvl, 1142), 0) - row.get((lvl, 2792), 0)
            for lvl in (0, 9493, 11626)
        }
        a, n = att.get(m, {}), out_.get(m, {})

        def rate(ages: list[int], a=a, n=n) -> float:
            yes = sum(a.get((x,), 0) for x in ages)
            return yes / (yes + sum(n.get((x,), 0) for x in ages) or 1)

        pop_15_17 = row.get((0, 2792), 0)
        c = course.get(m, {})
        upper = sum(c.get((age, k), 0) for age in (2498, 92981) for k in (121403, 14431, 121405))
        out[m] = {
            "adults": 1 - adult[9493] / ((adult[0] - adult[11626]) or 1),
            "f5_6": rate([2488, 2489]),
            "f11_13": rate([14433]),  # 11–14: the age group this table has
            "f15_17": _done(row, [2792], [9493], 0, 11626) or 0.0,
            "f15_17_proxy": upper / pop_15_17 if pop_15_17 else 0.0,
            "f18_20": _done(row, [92982, 1144], [9493, 9494], 0, 11626) or 0.0,
        }
    return out


def education_2022() -> dict[str, dict[str, float]]:
    # Table 10061: people 18+ by schooling and age.
    edu = values(10061, 2022, 2667, {1568: "all", 58: [95253, 2793, 1144]})
    # Table 10056: school attendance rate by single age.
    rate = values(10056, 2022, 3795, {58: "all"})
    # Table 10058: attending school, 6–17, by level and single age.
    course = values(
        10058,
        2022,
        13283,
        {11798: [95300, 7906, 7907, 7908, 7909, 95307], 58: [2489, 2493, 2494, 2495, 2496, 2498, 2499, 2500]},
    )
    # Table 9514: population by single age, to weigh the rates.
    pop = values(9514, 2022, 93, {287: [6561, 6562, 6563, 6567, 6568, 6569, 6570]})
    out: dict[str, dict[str, float]] = {}
    for m, row in edu.items():
        r, c, p = rate.get(m, {}), course.get(m, {}), pop.get(m, {})

        def weighted(ages: list[tuple[int, int]], r=r, p=p) -> float:
            n = sum(p.get((pa,), 0) for _, pa in ages)
            return sum(r.get((ra,), 0) / 100 * p.get((pa,), 0) for ra, pa in ages) / n if n else 0.0

        # 15–17 year-olds, from those attending school and the attendance rate.
        pop_15_17 = sum(c.get((95300, a), 0) / (r[(a,)] / 100) for a in (2498, 2499, 2500) if r.get((a,)))
        upper = sum(c.get((k, a), 0) for a in (2498, 2499, 2500) for k in (7908, 7909, 95307))
        out[m] = {
            "adults": 1 - row.get((9493, 95253), 0) / (row.get((120704, 95253), 0) or 1),
            "f5_6": weighted([(2488, 6562), (2489, 6563)]),
            "f11_13": weighted([(2494, 6568), (2495, 6569), (2496, 6570)]),
            "f15_17_proxy": upper / pop_15_17 if pop_15_17 else 0.0,
            "f18_20": _done(row, [2793, 1144], [9493, 9494], 120704, None) or 0.0,
        }
    return out


def mae(pred: dict[str, float], truth: dict[str, float]) -> float:
    keys = [k for k in pred if k in truth]
    return sum(abs(pred[k] - truth[k]) for k in keys) / len(keys)


def estimate() -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """IDHM 2022 and its three indices by municipality, and the method's errors on 2010."""
    official = {
        code: {k: v[2010] for k, v in by_territory(code, "Municípios").items() if 2010 in v}
        for code in ("ADH_IDHM", "ADH_IDHM_R", "ADH_IDHM_E", "ADH_IDHM_L")
    }

    # Education: the 15–17 proxy fitted to the exact 2010 indicator, then the index fitted
    # to the official one.
    e10, e22 = education_2010(), education_2022()
    common = [m for m in e10 if m in official["ADH_IDHM_E"]]
    a, b = solve([[1, e10[m]["f15_17_proxy"]] for m in common], [e10[m]["f15_17"] for m in common])

    def raw_education(d: dict[str, float]) -> float:
        flow = [d["f5_6"], d["f11_13"], min(a + b * d["f15_17_proxy"], 1.0), d["f18_20"]]
        return education_index(d["adults"], flow)

    ea, eb = solve([[1, raw_education(e10[m])] for m in common], [official["ADH_IDHM_E"][m] for m in common])
    education = {m: ea + eb * raw_education(d) for m, d in e22.items()}

    # Income: the Atlas formula on 2022 income in August 2010 reais.
    income = {
        m: income_index(row[()] * INPC_2010_08 / INPC_2022_07)
        for m, row in values(10295, 2022, 13431, {}).items()
        if row.get(())
    }

    # Longevity: child mortality (Brass's data, shrunk to the state) and income, fitted to
    # the official 2010 index. Mortality alone leaves small towns too noisy.
    q10 = child_mortality(children(96, 2010, 694, 1608, 380))
    q22 = child_mortality(children(10078, 2022, 13315, 13316, 13318))
    common_l = [m for m in q10 if m in official["ADH_IDHM_L"]]
    la, lb, lc = solve(
        [[1, q10[m], official["ADH_IDHM_R"][m]] for m in common_l],
        [official["ADH_IDHM_L"][m] for m in common_l],
    )
    longevity = {m: la + lb * q22[m] + lc * income[m] for m in q22 if m in income}

    # Validation: the same calibrated method on 2010, against the official figures.
    e_2010 = {m: ea + eb * raw_education(e10[m]) for m in common}
    l_2010 = {m: la + lb * q10[m] + lc * official["ADH_IDHM_R"][m] for m in common_l}
    idhm_2010 = {
        m: (official["ADH_IDHM_R"][m] * e_2010[m] * l_2010[m]) ** (1 / 3) for m in common if m in l_2010
    }
    errors = {
        "education": mae(e_2010, official["ADH_IDHM_E"]),
        "longevity": mae(l_2010, official["ADH_IDHM_L"]),
        "idhm": mae(idhm_2010, official["ADH_IDHM"]),
    }
    # Level: each state's mean, weighted by population, set to the official 2022 index of the
    # state (Atlas, from PNAD Contínua). The census sets the differences between towns.
    people = {m: row[()] for m, row in values(10295, 2022, 13604, {}).items() if row.get(())}
    indices = {"income": income, "education": education, "longevity": longevity}
    for key, code in (("income", "IDHMRE"), ("education", "IDHMED"), ("longevity", "IDHMLO")):
        target = {uf: s[YEAR] for uf, s in by_territory(code, "Estados").items() if YEAR in s}
        mean: dict[str, list[float]] = {}
        for m, v in indices[key].items():
            acc = mean.setdefault(m[:2], [0.0, 0.0])
            acc[0] += v * people.get(m, 0)
            acc[1] += people.get(m, 0)
        indices[key] = {
            m: v * target[m[:2]] * mean[m[:2]][1] / mean[m[:2]][0] for m, v in indices[key].items()
        }

    out = {}
    for m in longevity:
        if m in education:
            r, e, lg = (min(indices[k][m], 1.0) for k in ("income", "education", "longevity"))
            out[m] = {"idhm": (r * e * lg) ** (1 / 3), "income": r, "education": e, "longevity": lg}
    return out, errors


def main() -> int:
    est, errors = estimate()
    people = {m: row[()] for m, row in values(10295, 2022, 13604, {}).items() if row.get(())}
    total = sum(people.get(m, 0) for m in est)
    brazil = {
        k: sum(v[k] * people.get(m, 0) for m, v in est.items()) / total for k in next(iter(est.values()))
    }
    print(f"IDHM 2022 (estimate): {len(est)} municipalities")
    print("  Brazil, weighted by population: " + ", ".join(f"{k} {v:.3f}" for k, v in brazil.items()))
    print(f"  life expectancy implied: {25 + 60 * brazil['longevity']:.1f} years")
    print(
        "  validation on 2010, mean absolute error: " + ", ".join(f"{k} {v:.3f}" for k, v in errors.items())
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
