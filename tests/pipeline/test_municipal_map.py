from pipeline.municipal_map import build_race, match_codes, normalize_name, slim_topology

IBGE = {
    "2900108": {"name": "Abaíra", "uf": "BA"},
    "2910057": {"name": "Dias d'Ávila", "uf": "BA"},
    "3550001": {"name": "São Luiz do Paraitinga", "uf": "SP"},
    "2405306": {"name": "Januário Cicco", "uf": "RN"},
}


def test_normalize_name_ignores_accents_case_and_punctuation():
    assert normalize_name("Dias d'Ávila") == normalize_name("DIAS D ÁVILA") == "DIASDAVILA"
    assert normalize_name("Santa Bárbara D'Oeste") == "SANTABARBARADOESTE"


def test_match_codes_by_state_and_name_with_overrides():
    tse = {
        "33014": ("BA", {"ABAÍRA"}),
        "30872": ("BA", {"DIAS D ÁVILA"}),
        "71013": ("SP", {"SÃO LUÍS DO PARAITINGA"}),  # spelled differently
        "17035": ("RN", {"BOA SAÚDE"}),  # renamed
    }
    mapping, unmatched = match_codes(tse, IBGE, {"17035": "2405306"})
    assert mapping == {"33014": "2900108", "30872": "2910057", "17035": "2405306"}
    assert unmatched == ["71013 SP SÃO LUÍS DO PARAITINGA"]


def test_match_codes_does_not_cross_states():
    mapping, unmatched = match_codes({"1": ("SP", {"ABAÍRA"})}, IBGE, {})
    assert mapping == {} and len(unmatched) == 1


def test_build_race():
    votes = {
        "1": {("PT", "LULA"): 600, ("PL", "JAIR BOLSONARO"): 400},
        "2": {("PT", "LULA"): 100, ("PL", "JAIR BOLSONARO"): 350, ("PDT", "CIRO GOMES"): 550},
    }
    race = build_race(
        votes,
        ["A", "B", "C"],
        {"A": "1", "B": "2"},
        {"PT": "Lula", "PL": "Bolsonaro"},
        {"Lula": "red", "Bolsonaro": "blue"},
    )
    # National top two first, then anyone else who won or placed second somewhere.
    assert race["candidates"] == ["Bolsonaro", "Lula", "Ciro Gomes"]
    assert race["colors"] == {"Bolsonaro": "blue", "Lula": "red", "Ciro Gomes": "gray"}
    assert race["winner"] == [1, 2, -1]  # C has no results (created after the election)
    assert race["winnerShare"] == [600, 550, 0]
    assert race["second"] == [0, 0, -1]
    assert race["secondShare"] == [400, 350, 0]
    assert race["votes"] == [1000, 1000, 0]


def test_slim_topology_keeps_geometry_order_and_drops_properties():
    raw = {
        "type": "Topology",
        "arcs": [],
        "objects": {
            "foo": {
                "type": "GeometryCollection",
                "geometries": [
                    {"type": "Polygon", "arcs": [[0]], "properties": {"codarea": "2900108"}},
                    {"type": "Polygon", "arcs": [[1]], "properties": {"codarea": "2910057"}},
                ],
            }
        },
    }
    topology, order = slim_topology(raw)
    assert order == ["2900108", "2910057"]
    assert topology["objects"]["municipalities"]["geometries"] == [
        {"type": "Polygon", "arcs": [[0]]},
        {"type": "Polygon", "arcs": [[1]]},
    ]
