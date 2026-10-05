from pathlib import Path

from pipeline.capitals import contains, president_votes

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "tse"


def test_reads_the_president_count_from_a_ballot_box_report():
    # Recife, zone 1, section 31, 2026 1st round: 307 voters turned up.
    votes = president_votes((FIXTURES / "o03220pe2531300010031-bu.dat").read_bytes())
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
