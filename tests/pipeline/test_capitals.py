from pathlib import Path

from pipeline.capitals import contains, president_votes, with_runoff

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "tse"


def test_reads_the_president_count_from_a_ballot_box_report():
    # Recife, zone 1, section 31, 2026 1st round: 307 voters turned up.
    votes = president_votes((FIXTURES / "o03220pe2531300010031-bu.dat").read_bytes(), 6257)
    assert votes == {13: 123, 14: 6, 22: 157, 55: 7, 70: 8, -1: 2, -2: 4}
    assert sum(votes.values()) == 307


def test_point_in_polygon_with_a_hole():
    square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    geometry = {"type": "Polygon", "coordinates": [square, hole]}
    assert contains(geometry, 2, 2)
    assert not contains(geometry, 5, 5)  # in the hole
    assert not contains(geometry, 12, 5)
    multi = {"type": "MultiPolygon", "coordinates": [[square], [[[20, 0], [30, 0], [30, 10], [20, 0]]]]}
    assert contains(multi, 28, 3)


def test_the_runoff_goes_beside_the_first_round_area_by_area():
    first = {
        "code": "1",
        "placed": 98.0,
        "missing": 0,
        "sections": 10,
        "areas": [
            {"id": "a", "valid": 100, "pt": 40.0, "rival": 50.0, "coverage": 100, "income": 900},
            {"id": "b", "valid": 80, "pt": 60.0, "rival": 30.0, "coverage": 100, "income": 700},
        ],
    }
    runoff = {
        "placed": 97.5,
        "missing": 2,
        "sections": 10,
        "areas": [{"id": "a", "valid": 95, "pt": 45.0, "rival": 55.0, "coverage": 90, "income": 900}],
    }
    out = with_runoff(first, runoff)
    assert out["r2"] == {"placed": 97.5, "missing": 2, "sections": 10}
    assert out["placed"] == 98.0  # the 1st round stays as it was
    assert out["areas"][0]["r2"] == {"valid": 95, "pt": 45.0, "rival": 55.0, "coverage": 90}
    assert out["areas"][0]["pt"] == 40.0
    assert "r2" not in out["areas"][1]  # no runoff report placed there


def test_colour_age_and_couples_from_summed_tract_counts():
    from pipeline.capitals import social, summed

    counts = {
        "t1": {
            "white": 60,
            "black": 10,
            "brown": 25,
            "asian": 4,
            "indigenous": 1,
            "age0": 30,
            "age9": 10,
            "age10": 10,
            "coupleOther": 98,
            "coupleSame": 2,
        },
        "t2": {
            "white": 20,
            "black": 30,
            "brown": 50,
            "asian": 0,
            "indigenous": 0,
            "age5": 50,
            "age10": 0,
            "coupleOther": 50,
            "coupleBoth": 0,
        },
    }
    s = social(summed(["t1", "t2"], counts))
    assert s["white"] == 40.0 and s["black"] == 20.0 and s["brown"] == 37.5
    assert s["negro"] == 57.5  # preto and pardo together
    assert s["elderly"] == 20.0  # 60 to 69 and 70 or more, of every age group
    assert s["sameSex"] == round(2 / 150 * 100, 2)
    assert all(v is None for v in social({}).values())


def test_homes_and_literacy_from_summed_tract_counts():
    from pipeline.capitals import social

    counts = {
        "homes": 200, "flat": 50, "bath2": 30, "bath3": 8, "bath4": 2, "sewer": 190,
        **{f"read{k}": 10 for k in range(13)},  # 130 people aged 15 or more
        **{f"literate{k}": 9 if k > 10 else 10 for k in range(13)},  # 2 of them cannot read
    }  # fmt: skip
    s = social(counts)
    assert s["flat"] == 25.0
    assert s["bathrooms"] == 20.0  # two, three, four or more
    assert s["sewer"] == 95.0
    assert s["illiterate"] == round(100 - 128 / 130 * 100, 1)


def test_inequality_between_areas_weights_each_by_its_people():
    from pipeline.capitals import gini_between

    # Two equal halves, one with three times the other's income: Gini 0.25.
    assert gini_between([{"population": 10, "income": 1000}, {"population": 10, "income": 3000}]) == 0.25
    # The same incomes held by one area of twice the people count twice.
    assert gini_between(
        [
            {"population": 1, "income": 1000},
            {"population": 1, "income": 1000},
            {"population": 2, "income": 3000},
        ]
    ) == gini_between([{"population": 2, "income": 1000}, {"population": 2, "income": 3000}])
    assert gini_between([{"population": 5, "income": 900}]) is None
    assert gini_between([{"population": 5, "income": 900}, {"population": 5, "income": 900}]) == 0.0


def test_every_ibge_district_of_sao_paulo_has_one_subprefeitura():
    from pipeline.capitals import plain, subprefeituras

    sub_of = subprefeituras()
    assert len(sub_of) == 96
    assert len(set(sub_of.values())) == 32
    assert sub_of[plain("Artur Alvim")] == "Penha"  # the IBGE's spelling, the city writes "Arthur"
    assert sub_of[plain("Sapopemba")] == "Sapopemba"  # its own since 2013


def test_areas_without_neighbourhoods_are_named_by_region_or_district():
    from pipeline.capitals import area_names

    named = {
        "NM_BAIRRO": {"a1": {"Centro": 10, "Boa Vista": 30}},
        "NM_SUBDIST": {"a2": {"Plano Piloto": 5}},
        "NM_DIST": {"a1": {"Recife": 40}, "a2": {"Brasília": 5}, "a3": {"Moema": 7, "Saúde": 9}},
    }
    assert area_names("a1", named) == ["Boa Vista", "Centro"]  # neighbourhoods, most populous first
    assert area_names("a2", named) == ["Plano Piloto"]  # no neighbourhood: its region
    assert area_names("a3", named) == ["Saúde", "Moema"]  # no region either: its districts
    assert area_names("a4", named) == []


def test_each_tract_goes_to_the_nearest_neighbourhood_of_its_own_district():
    from pipeline.capitals import nearest_bairro

    places = [
        ("Água Branca", 0.0, 0.0),
        ("Pompéia", 1.0, 0.0),
        ("Água Branca", 0.1, 0.0),
        ("Moema", 5.0, 5.0),
    ]
    district_of = {(0.0, 0.0): "lapa", (1.0, 0.0): "perdizes", (0.1, 0.0): "lapa", (5.0, 5.0): "moema"}
    names = {"lapa": "Lapa", "perdizes": "Perdizes", "moema": "Moema", "se": "Sé"}
    tracts = [
        ("t1", "lapa", 0.9, 0.0),  # nearer Pompéia, but Pompéia is in another district
        ("t2", "perdizes", 0.0, 0.0),
        ("t3", "se", 0.0, 0.0),  # no point in its district: the district's own name
    ]
    assert nearest_bairro(tracts, places, district_of, names) == {
        "t1": "Água Branca",
        "t2": "Pompéia",
        "t3": "Sé",
    }
