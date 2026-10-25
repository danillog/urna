import copy

import pytest

from pipeline.programs import ProgramError, link_key, normalize, seconds, validate, validate_debates

PAGES = {
    "a": [
        "Capa",
        "Vamos cortar  dez\nministérios – já no primeiro ano.",
        "Escola em tempo integral para todos.",
    ],
    "b": [
        "Capa",
        "Vamos manter o “salário mínimo” com aumento real.",
        "Escola em tempo integral, prioridade.",
    ],
}
CHANNELS = {"site": "https://a.example", "x": "https://x.com/a"}
PROGRAM = {
    "candidates": [
        {"id": "a", "channels": CHANNELS},
        {"id": "b", "channels": {"site": "https://b.example", "x": "https://x.com/b"}},
    ],
    "themes": [{"id": "gastos", "name": "Gastos"}],
    "cards": [
        {
            "id": "ministerios",
            "theme": "gastos",
            "candidate": "a",
            "text": "Cortar dez ministérios.",
            "sources": [{"page": 2, "quote": "cortar dez ministérios - já no primeiro ano"}],
        },
        {
            "id": "salario",
            "theme": "gastos",
            "candidate": "b",
            "text": "Manter o aumento real do salário mínimo.",
            "sources": [{"page": 2, "quote": 'manter o "salário mínimo" com aumento real'}],
        },
    ],
    "agree": [
        {
            "id": "integral",
            "text": "Escola em tempo integral.",
            "sources": {
                "a": [{"page": 3, "quote": "Escola em tempo integral para todos"}],
                "b": [{"page": 3, "quote": "Escola em tempo integral, prioridade"}],
            },
        }
    ],
}


def test_a_quote_matches_across_spacing_dashes_quotes_and_case():
    assert normalize("Vamos  CORTAR\n– “já”") == normalize('vamos cortar - "já"')
    validate(PROGRAM, PAGES)


def test_refuses_a_quote_that_is_not_on_its_page():
    bad = copy.deepcopy(PROGRAM)
    bad["cards"][0]["sources"][0]["page"] = 3
    with pytest.raises(ProgramError, match="not on page 3"):
        validate(bad, PAGES)
    bad["cards"][0]["sources"][0] = {"page": 2, "quote": "cortar vinte ministérios"}
    with pytest.raises(ProgramError, match="not on page 2"):
        validate(bad, PAGES)
    bad["cards"][0]["sources"][0] = {"page": 9, "quote": "cortar dez ministérios"}
    with pytest.raises(ProgramError, match="not in the PDF"):
        validate(bad, PAGES)


def test_refuses_a_theme_with_more_cards_for_one_side():
    bad = copy.deepcopy(PROGRAM)
    extra = copy.deepcopy(bad["cards"][0])
    extra["id"] = "outro"
    bad["cards"].append(extra)
    with pytest.raises(ProgramError, match="must be equal"):
        validate(bad, PAGES)


def test_refuses_an_agreement_quoted_from_one_program_only():
    bad = copy.deepcopy(PROGRAM)
    del bad["agree"][0]["sources"]["b"]
    with pytest.raises(ProgramError, match="a source in each program"):
        validate(bad, PAGES)


def test_both_candidates_list_the_same_networks_and_only_known_ones():
    bad = copy.deepcopy(PROGRAM)
    del bad["candidates"][1]["channels"]["x"]
    with pytest.raises(ProgramError, match="same networks"):
        validate(bad, PAGES)
    bad = copy.deepcopy(PROGRAM)
    bad["candidates"][0]["channels"]["myspace"] = "https://myspace.com/a"
    with pytest.raises(ProgramError, match="must be among"):
        validate(bad, PAGES)


def test_refuses_a_card_too_long_for_a_phone():
    bad = copy.deepcopy(PROGRAM)
    bad["cards"][0]["text"] = "x" * 181
    with pytest.raises(ProgramError, match="1 to 180 characters"):
        validate(bad, PAGES)


def test_links_compare_as_the_tse_spells_them():
    assert link_key("HTTPS://WWW.INSTAGRAM.COM/LULAOFICIAL?IGSH=abc") == link_key(
        "https://instagram.com/lulaoficial"
    )
    assert link_key("FLAVIOBOLSONARO.COM.BR") == link_key("https://flaviobolsonaro.com.br/")


def test_refuses_a_count_of_cards_equal_to_a_ballot_number():
    bad = copy.deepcopy(PROGRAM)
    bad["candidates"][0]["number"] = 2  # two cards in all
    with pytest.raises(ProgramError, match="ballot number"):
        validate(bad, PAGES)
    bad["candidates"][0]["number"] = 1  # one card each
    with pytest.raises(ProgramError, match="ballot number"):
        validate(bad, PAGES)


DEBATES = {
    "candidates": PROGRAM["candidates"],
    "debates": [{"id": "d", "video": "https://www.youtube.com/watch?v=RugVB17uRVM"}],
    "debateThemes": [{"id": "dividas", "name": "Dívidas"}],
    "promises": [
        {
            "id": f"p-{who}",
            "debate": "d",
            "theme": "dividas",
            "candidate": who,
            "time": "1:13:18",
            "text": "Comprar dívidas.",
            "quote": "a gente vai comprar a sua dívida",
        }
        for who in ("a", "b")
    ],
}


def test_debate_promises_are_balanced_and_tied_to_the_official_video():
    validate_debates(DEBATES)
    assert seconds("1:13:18") == 4398 and seconds("38:04") == 2284
    bad = copy.deepcopy(DEBATES)
    bad["promises"].append({**bad["promises"][0], "id": "extra"})
    with pytest.raises(ProgramError, match="must be equal"):
        validate_debates(bad)
    bad = copy.deepcopy(DEBATES)
    bad["debates"][0]["video"] = "https://youtu.be/RugVB17uRVM?t=10"
    with pytest.raises(ProgramError, match="official upload"):
        validate_debates(bad)
    bad = copy.deepcopy(DEBATES)
    bad["promises"][0]["time"] = "73 min"
    with pytest.raises(ProgramError, match="h:mm:ss"):
        validate_debates(bad)
