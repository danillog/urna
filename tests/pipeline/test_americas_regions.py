from pipeline.americas.regions import (
    RegionTable,
    consistent,
    parse_percent,
    parse_votes,
    pick_table,
    read_table,
)
from pipeline.sources.wikipedia import _TableParser, to_grid

INDEX = {"alpha": ["XX-A"], "beta": ["XX-B"], "gamma": ["XX-G"], "old": ["XX-O", "XX-N"], "new": ["XX-N"]}

TABLE = """<table>
<tr><th rowspan="2">Department</th><th colspan="2">Pérez</th><th colspan="2">Gómez</th>
    <th colspan="2">Blank votes</th><th rowspan="2">Turnout</th></tr>
<tr><th>Votes</th><th>%</th><th>Votes</th><th>%</th><th>Votes</th><th>%</th></tr>
<tr><td>Alpha</td><td>1,000</td><td>60.00%</td><td>600</td><td>36.00%</td><td>60</td><td>4%</td><td>70%</td></tr>
<tr><td>Beta</td><td>500</td><td>50.00%</td><td>500</td><td>50.00%</td><td>0</td><td>0%</td><td>70%</td></tr>
<tr><td>Old</td><td>100</td><td>50.00%</td><td>100</td><td>50.00%</td><td>0</td><td>0%</td><td>70%</td></tr>
<tr><td>New</td><td>10</td><td>10.00%</td><td>90</td><td>90.00%</td><td>0</td><td>0%</td><td>70%</td></tr>
<tr><td>Abroad</td><td>5</td><td>50%</td><td>5</td><td>50%</td><td>0</td><td>0%</td><td>9%</td></tr>
</table>"""


def table() -> RegionTable:
    p = _TableParser()
    p.feed(TABLE)
    return read_table(to_grid(p.tables[0]), INDEX)


def test_reads_one_vote_and_percent_column_per_candidate():
    t = table()
    assert t.candidates == ["Pérez", "Gómez"]  # blank votes and turnout are not candidates
    assert t.rows["XX-A"] == [1000, 600]
    assert t.percents["XX-A"] == [60.0, 36.0]


def test_a_region_own_row_wins_over_the_old_region_it_belonged_to():
    t = table()
    assert t.rows["XX-N"] == [10, 90]  # its own row, not "Old"
    assert t.rows["XX-O"] == [100, 100]


def test_consistency_check():
    assert consistent(table(), "Juan Pérez")
    clear_loss = RegionTable(["Pérez", "Gómez"], {"XX-A": [100, 50]})
    assert not consistent(clear_loss, "Ana Gómez")
    # Within 2% over the regions: votes cast abroad could decide it (Peru 2026).
    close = RegionTable(["Pérez", "Gómez"], {"XX-A": [1000, 990]})
    assert consistent(close, "Ana Gómez")
    # Spanish thousands separators read as decimals made a 963-vote candidate win.
    misread = RegionTable(["Mesa", "Mamani"], {"XX-A": [71.957, 963], "XX-B": [81.182, 10]})
    assert not consistent(misread, "Carlos Mesa")


def test_pick_table_prefers_the_runoff():
    first = RegionTable(["Pérez", "Gómez", "Ruiz"], {"XX-A": [5, 4, 3], "XX-B": [5, 4, 3]})
    runoff = RegionTable(["Pérez", "Gómez"], {"XX-A": [6, 5], "XX-B": [6, 5]})
    assert pick_table([first, runoff], "Juan Pérez", 2) is runoff


def test_number_conventions():
    assert parse_votes("1,234,567") == 1234567
    assert parse_votes("1.234.567") == 1234567
    assert parse_votes("71.957") == 71957
    assert parse_percent("46,07 %") == 46.07
    assert parse_percent("46.07%") == 46.07
