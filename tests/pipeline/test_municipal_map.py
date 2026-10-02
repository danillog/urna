import base64
import io
import zipfile
from array import array

from pipeline.fetch_tse_results import csv_members
from pipeline.municipal_map import (
    NONE,
    lineage_of,
    match_codes,
    mayor_race,
    normalize_name,
    presidential_race,
    slim_topology,
)

IBGE = {
    "2900108": {"name": "Abaíra", "uf": "BA"},
    "2910057": {"name": "Dias d'Ávila", "uf": "BA"},
    "3550001": {"name": "São Luiz do Paraitinga", "uf": "SP"},
    "2405306": {"name": "Januário Cicco", "uf": "RN"},
}
LINEAGES = {
    "UNIÃO": {"color": "cyan", "members": ["PFL", "DEM", "UNIÃO"]},
    "PSD": {"color": "orange", "members": [{"party": "PSD", "since": 2011}]},
}


def unpack(typecode: str, b64: str) -> list[int]:
    arr = array(typecode)
    arr.frombytes(base64.b64decode(b64))
    return arr.tolist()


def test_normalize_name_ignores_accents_case_and_punctuation():
    assert normalize_name("Dias d'Ávila") == normalize_name("DIAS D ÁVILA") == "DIASDAVILA"


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


def test_presidential_race():
    votes = {
        "1": {("LULA", "PT"): 600, ("JAIR BOLSONARO", "PL"): 400},
        "2": {("LULA", "PT"): 100, ("JAIR BOLSONARO", "PL"): 350, ("CIRO GOMES", "PDT"): 550},
    }
    race = presidential_race(
        votes,
        ["A", "B", "C"],
        {"A": ["1"], "B": ["2"]},
        {"PT": "Lula", "PL": "Bolsonaro"},
        {"Lula": "red", "Bolsonaro": "blue"},
    )
    # National top two first, then anyone else who won or placed second somewhere.
    assert race["labels"] == ["Bolsonaro", "Lula", "Ciro Gomes"]
    assert race["colors"] == {"Bolsonaro": "blue", "Lula": "red", "Ciro Gomes": "gray"}
    assert unpack("B", race["winner"]) == [1, 2, NONE]  # C has no result
    assert unpack("H", race["winnerShare"]) == [600, 550, 0]
    assert unpack("B", race["second"]) == [0, 0, NONE]
    assert unpack("H", race["secondShare"]) == [400, 350, 0]
    assert unpack("I", race["votes"]) == [1000, 1000, 0]


def test_mayor_race_uses_the_elected_candidate_and_merges_codes():
    votes = {
        "1": {("ANA", "PFL"): 500, ("BIA", "PT"): 500},  # tie: the TSE elected Bia
        "2": {("CAIO", "PSD"): 300},
        "3": {("CAIO", "PSD"): 200, ("DORA", "PT"): 100},  # same municipality, another TSE code
    }
    race = mayor_race(votes, {"1": ("BIA", "PT")}, ["X", "Y"], {"X": ["1"], "Y": ["2", "3"]}, 2000, LINEAGES)
    assert race["labels"][unpack("B", race["winner"])[0]] == "PT"
    assert race["mayors"].split("\n") == ["Bia", "Caio"]
    assert unpack("H", race["winnerShare"])[1] == 833  # 500 of 600 votes
    assert dict(zip(race["labels"], race["lineages"], strict=True))["PFL"] == "UNIÃO"
    assert dict(zip(race["labels"], race["lineages"], strict=True))["PSD"] == "others"  # the 1990s PSD


def test_lineage_of():
    assert lineage_of("PFL", 2000, LINEAGES) == "UNIÃO"
    assert lineage_of("PSD", 2012, LINEAGES) == "PSD"
    assert lineage_of("PSD", 2000, LINEAGES) == "others"
    assert lineage_of("PSOL", 2020, LINEAGES) == "others"


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
    assert topology["objects"]["municipalities"]["geometries"][0] == {"type": "Polygon", "arcs": [[0]]}


def test_csv_members_reads_only_the_national_file():
    def archive(*names):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for n in names:
                zf.writestr(n, "")
        return zipfile.ZipFile(buf)

    assert csv_members(archive("x_1996_AC.csv", "x_1996_BRASIL.csv", "leiame.pdf")) == ["x_1996_BRASIL.csv"]
    assert csv_members(archive("x_2022_AC.csv", "x_2022_BR.csv")) == ["x_2022_BR.csv"]
    assert csv_members(archive("x_2000_AC.csv", "x_2000_AL.csv")) == ["x_2000_AC.csv", "x_2000_AL.csv"]
