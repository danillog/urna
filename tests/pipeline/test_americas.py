import pytest

from pipeline.americas.discover import parse_date, read_infobox
from pipeline.americas.ideology import current_position, gps_band, position_family
from pipeline.americas.wikitext import find_template, link_target, plain, template_params


def test_template_params_keep_nested_templates_and_links():
    text = "{{Infobox election | party1 = [[Morena (political party)|Morena]] | x = {{a|b|c}} }}"
    span = find_template(text, "Infobox election")
    params = template_params(text[span[0] : span[1]])
    assert params == {"party1": "[[Morena (political party)|Morena]]", "x": "{{a|b|c}}"}


def test_plain_and_link_target():
    assert plain("'''[[Claudia Sheinbaum]]'''<ref>x</ref>") == "Claudia Sheinbaum"
    assert plain("{{Canadian party colour|CA|Liberal|name}}") == "Liberal"
    assert link_target("[[Union for the Homeland|UxP]]") == "Union for the Homeland"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("{{Start date|2024|6|2}}", "2024-06-02"),
        ("2 June 2024", "2024-06-02"),
        ("November 5, 2024", "2024-11-05"),
    ],
)
def test_parse_date(raw, expected):
    assert parse_date(raw) == expected


def test_read_infobox_prefers_who_took_office_over_first_listed():
    # Argentina 2003: Menem led the first round, then withdrew; Kirchner took office.
    text = """{{Infobox election | election_date = 27 April 2003
    | nominee1 = [[Carlos Menem]] | party1 = [[Justicialist Party]]
    | title = [[President of Argentina|President]]
    | after_election = [[Néstor Kirchner]] | after_party = [[Front for Victory|FPV-PJ]] }}"""
    info = read_infobox(text, "presidential")
    assert info == {
        "date": "2003-04-27",
        "winner": "Néstor Kirchner",
        "party": "FPV-PJ",
        "party_article": "Front for Victory",
    }


def test_read_infobox_ignores_a_speaker_in_after_election():
    text = """{{Infobox legislative election | election_date = 25 May 2010
    | party1 = [[NDP]] | leader1 = [[Dési Bouterse]]
    | title = [[Speaker of the National Assembly|Speaker]] | after_election = [[Jennifer Simons]] }}"""
    info = read_infobox(text, "general")
    assert info["winner"] == "Dési Bouterse"
    assert "review" in info


def test_read_infobox_marks_annulled_and_disputed():
    annulled = (
        "{{Infobox election | election_date = 20 October 2019 | nominee1 = X | party1 = Y"
        " | after_election = Election results annulled }}"
    )
    assert read_infobox(annulled, "presidential")["status"] == "annulled"
    disputed = (
        "{{Infobox election | election_date = 28 July 2024 | nominee1 = X | party1 = Y"
        " | after_election = [[Nicolás Maduro]] (Disputed) | after_party = [[PSUV]] }}"
    )
    info = read_infobox(disputed, "presidential")
    assert info["status"] == "disputed" and info["winner"] == "Nicolás Maduro"


@pytest.mark.parametrize(
    ("score", "family"),
    [
        (0, "left"),
        (2.49, "left"),
        (2.5, "centre-left"),
        (4.9, "centre-left"),
        (5.0, "centre-right"),
        (7.5, "right"),
    ],
)
def test_gps_bands(score, family):
    assert gps_band(score) == family


@pytest.mark.parametrize(
    ("position", "family"),
    [
        ("Left-wing", "left"),
        ("Centre-left to left-wing", "centre-left"),
        ("Centre-right to right-wing", "right"),
        ("Centre to centre-left", "centre-left"),
        ("Current: Centre-right to right-wing Historical: Centre-left to left-wing", "right"),
        ("Centre-left 1979–1981: Left-wing", "centre-left"),
        ("Centre", None),
        ("Syncretic", None),
    ],
)
def test_position_family(position, family):
    assert position_family(position) == family


def test_current_position_strips_list_markup():
    assert current_position("{{ubl|class=nowrap| |Centre-right |Historically: |Centre }}") == "Centre-right"
