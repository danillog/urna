import pytest

from pipeline.sources import tse_results

CONFIG = {
    "pl": [
        {
            "cd": "452",
            "dt": "06/10/2024",
            "e": [{"cd": "619", "t": "1", "nm": "Eleição Ordinária Municipal - 2024"}],
        },
        {"cd": "3207", "dt": "05/10/2025", "e": [{"cd": "6240", "t": "1", "nm": "Eleição Suplementar - X"}]},
        {
            "cd": "3220",
            "dt": "04/10/2026",
            "e": [
                {"cd": "6257", "t": "1", "nm": "Eleição Ordinária Federal - 2026 1º Turno"},
                {"cd": "6259", "t": "1", "nm": "Eleição Ordinária Estadual - 2026 1º Turno"},
            ],
        },
        {
            "cd": "3221",
            "dt": "25/10/2026",
            "e": [
                {"cd": "6258", "t": "2", "nm": "Eleição Ordinária Federal - 2026 2º Turno"},
                {"cd": "6260", "t": "2", "nm": "Eleição Ordinária Estadual - 2026 2º Turno"},
            ],
        },
    ]
}


def test_parse_config_finds_each_round_of_the_year_and_skips_supplementary_elections():
    assert tse_results.parse_config(CONFIG, 2026) == {
        "r1": {"pleito": "3220", "date": "04/10/2026", "federal": "6257", "state": "6259"},
        "r2": {"pleito": "3221", "date": "25/10/2026", "federal": "6258", "state": "6260"},
    }
    assert tse_results.parse_config(CONFIG, 2025) == {}


def test_a_round_not_listed_yet_says_so(monkeypatch):
    first_round_only = {"pl": CONFIG["pl"][:3]}
    monkeypatch.setattr(tse_results, "config", lambda year: tse_results.parse_config(first_round_only, year))
    assert tse_results.election(2026, "r1", "federal") == "6257"
    with pytest.raises(tse_results.NotPublished):
        tse_results.election(2026, "r2", "federal")


def test_file_urls():
    assert tse_results.file_url(2026, "6257", 1, "br") == (
        "https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json"
    )
    assert tse_results.file_url(2024, "620", 11, "71072", "sp") == (
        "https://resultados.tse.jus.br/oficial/ele2024/620/dados/sp/sp71072-c0011-e000620-u.json"
    )
