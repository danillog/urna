import math

import pytest

from pipeline.idhm_census import (
    MOTHERS,
    SHRINK_BIRTHS,
    child_mortality,
    education_index,
    income_index,
    logit,
    solve,
)
from pipeline.sources.sidra import parse


def test_income_index_matches_the_atlas_scale():
    assert income_index(8) == 0
    assert income_index(4033) == pytest.approx(1)
    # Brazil 2010: R$ 793.87 a month → 0.739 in the Atlas.
    assert income_index(793.87) == pytest.approx(0.739, abs=5e-4)
    assert income_index(5) == 0 and income_index(10_000) == 1


def test_education_index_weighs_flow_twice():
    assert education_index(0.5, [0.8, 0.8, 0.8, 0.8]) == pytest.approx((0.5 * 0.8 * 0.8) ** (1 / 3))
    assert education_index(0, [1, 1, 1, 1]) == 0


def test_solve_recovers_a_linear_relation():
    rows = [[1, x, x * x] for x in range(10)]
    ys = [2 + 3 * x - 0.5 * x * x for x in range(10)]
    assert solve(rows, ys) == pytest.approx([2, 3, -0.5])


def test_child_mortality_pulls_small_towns_toward_their_state():
    def town(born: float, dead: float) -> dict[str, list[float]]:
        n = len(MOTHERS)
        return {
            "women": [1.0] * n,
            "born": [born] + [0.0] * (n - 1),
            "alive": [born - dead] + [0.0] * (n - 1),
        }

    data = {"3500001": town(100_000, 2_000), "3500002": town(100, 10)}  # state: 2.0% vs a 10% outlier
    q = child_mortality(data)
    state = (2_010) / (100_100)
    expected = (10 + SHRINK_BIRTHS * state) / (100 + SHRINK_BIRTHS)
    assert q["3500002"] == pytest.approx(logit(expected))
    assert math.exp(q["3500002"]) / (1 + math.exp(q["3500002"])) < 0.03
    assert q["3500001"] == pytest.approx(logit((2_000 + SHRINK_BIRTHS * state) / (100_000 + SHRINK_BIRTHS)))


def test_sidra_parse_keys_by_category_and_skips_suppressed_cells():
    response = [
        {
            "resultados": [
                {
                    "classificacoes": [
                        {"id": "58", "categoria": {"2793": "18 a 19 anos"}},
                        {"id": "1568", "categoria": {"9493": "Sem instrução"}},
                    ],
                    "series": [
                        {"localidade": {"id": "1100015"}, "serie": {"2022": "120"}},
                        {"localidade": {"id": "1100023"}, "serie": {"2022": "-"}},
                    ],
                }
            ]
        }
    ]
    assert parse(response, [1568, 58]) == {"1100015": {(9493, 2793): 120.0}}
