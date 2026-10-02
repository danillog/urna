import pytest

from pipeline.sources.tse_registry import classify_scope

STATES = {"SP": "São Paulo", "TO": "Tocantins", "PA": "Pará"}


def row(text: str, uf: str = "BR") -> dict[str, str]:
    return {"SG_UF": uf, "DS_PLANO_AMOSTRAL": text, "DS_DADO_MUNICIPIO": ""}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Amostra representativa do eleitorado brasileiro com 16 anos ou mais", "BR"),
        ("A área de abrangência da coleta é nacional.", "BR"),
        ("Municípios das cinco grandes regiões geográficas", "BR"),
        ("Representativa do eleitorado do estado DO TOCANTINS", "TO"),
        ("A área de abrangência é o estado do Pará", "PA"),
        ("Ponderação pelo Censo do Instituto Brasileiro de Geografia; população brasileira", None),
        ("Representativo do eleitorado da área em estudo", None),
    ],
)
def test_presidential_scope_comes_from_the_sample_description(text, expected):
    assert classify_scope(row(text), STATES) == expected


def test_state_offices_use_the_registered_state():
    assert classify_scope(row("qualquer coisa", uf="SP"), STATES) == "SP"
