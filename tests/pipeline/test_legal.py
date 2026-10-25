from datetime import date

import pytest

from pipeline.legal import LegalError, merge, validate

TODAY = date(2026, 10, 5)
PEOPLE = {"fulano-sp-deputado-federal", "beltrana-rj-senador"}


def case(**over):
    base = {
        "person": "fulano-sp-deputado-federal",
        "grade": "reu",
        "crime": "peculato",
        "court": "STF",
        "case": "AP 9999",
        "since": date(2025, 3, 1),
        "url": "https://portal.stf.jus.br/processos/detalhe.asp?incidente=1",
        "checked": date(2026, 10, 1),
        "checkedBy": "XX",
    }
    return {**base, **over}


def test_a_complete_case_from_an_official_page_passes():
    assert validate([case()], PEOPLE, TODAY) == []


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"url": "https://g1.globo.com/politica/x"}, "official"),
        ({"url": "http://portal.stf.jus.br/x"}, "official"),  # https only
        ({"url": "https://stf.jus.br.example.com/x"}, "official"),
        ({"grade": "suspeito"}, "grade"),
        ({"person": "ninguem"}, "no elected person"),
        ({"crime": ""}, "missing crime"),
        ({"checkedBy": None}, "missing checkedBy"),
        ({"case": "processo 12"}, "case number"),
        ({"checked": date(2026, 12, 1)}, "dates"),
        ({"since": date(2026, 10, 3)}, "dates"),
    ],
)
def test_anything_short_of_that_is_refused(override, message):
    with pytest.raises(LegalError, match=message):
        validate([case(**override)], PEOPLE, TODAY)


def test_the_same_case_twice_is_refused_and_old_checks_are_flagged():
    with pytest.raises(LegalError, match="twice"):
        validate([case(), case()], PEOPLE, TODAY)
    assert validate([case(checked=date(2026, 1, 2))], PEOPLE, TODAY)  # a warning, not an error


def test_merge_publishes_no_reviewer_and_clears_removed_cases():
    profiles = {
        "people": [
            {"id": "fulano-sp-deputado-federal"},
            {"id": "beltrana-rj-senador", "legal": [{"case": "Inq 1"}]},  # removed from the file since
        ]
    }
    out = merge(profiles, [case(), case(case="Inq 8888", grade="arquivado", since=date(2024, 1, 1))], TODAY)
    fulano, beltrana = out["people"]
    assert [c["case"] for c in fulano["legal"]] == ["AP 9999", "Inq 8888"]  # newest first
    assert "checkedBy" not in fulano["legal"][0]
    assert fulano["legal"][0]["stale"] is False
    assert "legal" not in beltrana
    assert out["legalChecked"] == "2026-10-01"
