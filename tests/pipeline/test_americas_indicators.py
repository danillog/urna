import csv
import io
import zipfile

from pipeline.americas.indicators import (
    FALLBACK_MAX_AGE,
    MISSING_WHY,
    USDA_PERIODS,
    centre_year,
    ebia,
    food_missing,
    latest,
    parse_fao,
    poverty_fallback,
    poverty_missing,
    saipe_states,
    usda_national,
    usda_states,
)

SURVEYS = {
    "JAM": [
        {"year": 2018, "value": 18.3, "welfare": "consumption"},
        {"year": 2021, "value": 22.9, "welfare": "consumption"},
    ],
    "HTI": [{"year": 2012, "value": 89.8, "welfare": "income"}],
    "VEN": [{"year": 2006, "value": 43.4, "welfare": "income"}],
    "MEX": [{"year": 2024, "value": 21.4, "welfare": "income"}],
}
MAIN = {"MEX": {2022: 27.4, 2024: 21.4}, "HTI": {2012: 89.8}, "VEN": {2006: 43.4}}


def test_latest_respects_the_age_limit():
    assert latest({2020: 1.0, 2024: 2.0}, 2026, 4) == 2024
    assert latest({2020: 1.0}, 2026, 4) is None
    assert latest(SURVEYS["JAM"], 2026, FALLBACK_MAX_AGE) == 2021
    assert latest(SURVEYS["JAM"], 2017, FALLBACK_MAX_AGE) is None  # before the first survey


def test_fallback_only_for_countries_with_a_gap_it_fills():
    fallback = poverty_fallback(MAIN, SURVEYS, 2000, 2026, 4)
    # Jamaica: no income series at all, consumption surveys within 10 years.
    assert fallback["JAM"] == SURVEYS["JAM"]
    # Haiti: blank from 2017, and its 2012 survey still within 10 years until 2022.
    assert "HTI" in fallback
    # Mexico's main series never leaves a gap.
    assert "MEX" not in fallback


def test_missing_says_why_and_skips_what_is_shown():
    why = poverty_missing(MAIN, SURVEYS, 2026, 4)
    assert "JAM" not in why and "MEX" not in why  # shown: fallback, main
    assert why["VEN"] == MISSING_WHY["VEN"]
    assert "2012" in why["HTI"]  # too old: says the year
    assert "nenhuma pesquisa" in why["CUB"] or why["CUB"] == MISSING_WHY["CUB"]
    assert "nenhuma pesquisa" in why["BHS"]  # never surveyed


def test_saipe_keeps_the_states_rate_not_the_counties():
    text = (
        "00   0 40763043 40485829 41040257 12.5 12.4 12.6 United States US\n"
        "01   0   780043   762230   797856 15.7 15.3 16.1 Alabama AL\n"
        "01   1     7004     5599     8409 11.7  9.3 14.1 Autauga County AL\n"
        "11   0   110233   103777   116689 16.4 15.4 17.4 District of Columbia DC\n"
    )
    assert saipe_states(text) == {"US-AL": 15.7, "US-DC": 16.4}


def fao_zip(rows: list[dict]) -> bytes:
    """A FAOSTAT bulk file with these rows."""
    fields = ["Area Code (M49)", "Area", "Item Code", "Element", "Year", "Value", "Flag"]
    text = io.StringIO()
    writer = csv.DictWriter(text, fields)
    writer.writeheader()
    writer.writerows(rows)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("Food_Security_Data_E_All_Data_(Normalized).csv", text.getvalue().encode("latin-1"))
    return out.getvalue()


def test_fao_values_sit_at_the_middle_year_with_the_floor_and_flags_kept():
    assert centre_year("2014-2016") == 2015
    assert centre_year("2023-2025") == 2024

    def row(m49: str, year: str, value: str, **extra: str) -> dict:
        base = {"Area Code (M49)": f"'{m49}", "Area": m49, "Item Code": "210091", "Element": "Value"}
        return {**base, "Year": year, "Value": value, "Flag": "E", **extra}

    raw = fao_zip(
        [
            row("076", "2022-2024", "13.3"),
            row("076", "2022-2024", "12.9", Element="Confidence interval: Lower bound"),
            row("124", "2014-2016", "<2.5"),
            row("862", "2022-2024", "", Flag="Q"),
            row("076", "2023", "9.6", **{"Item Code": "210090"}),  # the annual item
            row("250", "2022-2024", "6"),  # France: not on the map
        ]
    )
    values, floor, flags = parse_fao(raw)
    # Only the 3-year averages' values, of the map's countries, at the centre year.
    assert values == {"BRA": {2023: 13.3}, "CAN": {2015: 2.5}}
    assert floor == {"CAN"}
    assert flags == {"VEN": {"Q"}}


def test_food_missing_tells_suppressed_from_absent_and_old():
    values = {"LCA": {2017: 25.9}, "USA": {2024: 10.7}}
    why = food_missing(values, {"VEN": frozenset("Q"), "CUB": frozenset("O")}, 2026, 4)
    assert "USA" not in why
    assert why["LCA"] == "O último dado da FAO aqui é a média de 2016–2018."
    assert why["VEN"] == "A FAO não publica o dado deste país."
    assert "não tem medição" in why["CUB"]


USDA = """
Table 1A
U.S. households and individuals by food security status of household, 2001–24
Households
 2024 134,062 115,722 86.3 18,340 13.7 11,138 8.3 7,202 5.4
 2001 107,824 96,303 89.3 11,521 10.7 8,010 7.4 3,511 3.3
All individuals (by food security status of household)
 2024 332,179 284,279 85.6 47,900 14.4 31,368 9.4 16,532 5.0
Note: table 1A.
\fTable 5
Change in prevalence of household food insecurity
U.S. 13.3 10.4 14.3 2.9* -1.0* 5.2 4.0 5.6 1.2* -0.4*
AR 19.4 15.0 19.9 4.4* -.5 7.6 6.3 8.1 1.3 -.5
Note: table 5.
"""


def test_usda_tables_read_newest_last_and_households_only():
    assert usda_national(USDA) == {2024: 13.7, 2001: 10.7}
    assert USDA_PERIODS == ["2012–2014", "2019–2021", "2022–2024"]
    try:
        usda_states(USDA)
    except ValueError as e:
        assert "1 states read" in str(e)  # every state is required
    else:
        raise AssertionError("a partial table 5 must fail")


def test_ebia_adds_moderate_and_severe_by_place_and_year():
    rows = [
        {"V": "Valor"},
        {"V": "2.2", "D1C": "11", "D3C": "2023", "D5C": "109101"},
        {"V": "1.1", "D1C": "11", "D3C": "2023", "D5C": "109102"},
        {"V": "-", "D1C": "12", "D3C": "2023", "D5C": "109101"},
    ]
    assert ebia(rows, "D1C") == {("11", 2023): 3.3}
