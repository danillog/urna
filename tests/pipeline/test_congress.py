import yaml

from pipeline.congress import CONFIG, Placer, build, project_seats, read_bls


def config():
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8"))


def test_every_election_fills_the_house():
    cfg = config()
    for year, seats in cfg["chamber"].items():
        assert sum(seats.values()) == (503 if year == 1990 else 513), year
    for year, seats in cfg["senate"].items():
        assert sum(seats.values()) == 81, year


def test_placement_follows_the_term_and_its_wave():
    placer = Placer(config(), read_bls())
    # PSDB started on the centre-left and moved right: 1990 → wave 1993, 2018 → 2021.
    assert placer.score("PSDB", 1990) == (placer.bls["PSDB"][1993], "bls-1993")
    assert placer.group(placer.score("PSDB", 1990)[0]) == "centre-left"
    assert placer.score("PSDB", 2018)[1] == "bls-2021"
    # The old PP of 1993–95 is not today's Progressistas.
    assert placer.score("PP", 1994) == (placer.bls["PPold"][1993], "bls-1993")
    assert placer.score("PP", 2022)[0] == placer.bls["PP"][2021]


def test_no_estimate_borrowed_across_a_decade():
    placer = Placer(config(), read_bls())
    # The PSL of 2002 was a minor party; its only estimate is from 2021.
    assert placer.score("PSL", 2002) == (None, None)
    assert placer.score("PSL", 2018)[1] == "bls-2021"


def test_bolognesi_is_converted_and_mergers_average():
    placer = Placer(config(), read_bls())
    assert placer.b > 0  # same direction on both scales
    avante, source = placer.score("Avante", 2018)
    assert source == "bolognesi" and -1 < avante < 1
    uniao, source = placer.score("UNIÃO", 2022)
    assert source == "mean:DEM+PSL"
    assert uniao == (placer.bls["DEM"][2021] + placer.bls["PSL"][2021]) / 2


def test_build_orders_parties_left_to_right():
    out = build(config(), read_bls(), None)
    for entries in out["houses"].values():
        for e in entries:
            scores = [p["score"] for p in e["parties"] if p["score"] is not None]
            assert scores == sorted(scores)
            # unplaced parties come last
            placed = [p["score"] is not None for p in e["parties"]]
            assert placed == sorted(placed, reverse=True)
    # renames share a line: PFL in 2002 and DEM in 2010
    lineage = {p["party"]: p["lineage"] for e in out["houses"]["chamber"] for p in e["parties"]}
    assert lineage["PFL"] == lineage["DEM"] == "DEM"


def test_projection_matches_the_law():
    # 10 seats, 1000 valid votes: QE = 100. Quotients give A 4, B 3, C 2; the last seat
    # goes to the best average among lists with 80% of QE (A: 450/5 = 90), to a
    # candidate with 20% of QE (A's fifth, 20 votes).
    lists = [{"key": "A", "votes": 450}, {"key": "B", "votes": 350}, {"key": "C", "votes": 200}]
    cands = [
        {"list": k, "party": k, "votes": v, "elected": False}
        for k, votes in (("A", [300, 60, 40, 30, 20]), ("B", [200, 80, 40, 30]), ("C", [150, 50]))
        for v in votes
    ]
    project_seats(lists, cands, 10, 1000)
    won = {k: sum(c["elected"] for c in cands if c["list"] == k) for k in "ABC"}
    assert won == {"A": 5, "B": 3, "C": 2}


def test_centrao_is_marked_only_from_its_source_year():
    out = build(config(), read_bls(), None)
    by_year = {e["year"]: e for e in out["houses"]["chamber"]}
    marked = {p["party"] for p in by_year[2022]["parties"] if p["centrao"]}
    assert marked == {"PP", "Republicanos", "PL", "UNIÃO", "PSD", "Avante", "SD"}
    assert not any(p["centrao"] for p in by_year[2018]["parties"])
