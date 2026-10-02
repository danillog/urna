from datetime import date

from pipeline.sources.wikipedia import _TableParser, parse_end_date, parse_table, year_section

# Trimmed copy of the layout used by "Opinion polling for the 2026 Brazilian presidential election".
TABLE = """
<table>
<tr><th rowspan="3">Pollster</th><th rowspan="3">Polling<br>period</th><th></th><th></th><th></th>
    <th rowspan="3">Others</th><th rowspan="3">Blank<br>Null<br>Undec.</th><th rowspan="3">Sample<br>size</th>
    <th rowspan="3">Lead</th></tr>
<tr><th>Lula<br>PT</th><th>F. Bolsonaro<br>PL</th><th>Cury<br>Avante</th></tr>
<tr><th></th><th></th><th></th></tr>
<tr><td rowspan="2">Datafolha</td><td rowspan="2">28–30 Sep</td><td>42</td><td>38</td><td>4</td><td>2</td>
    <td>7</td><td rowspan="2">2,506</td><td>4</td></tr>
<tr><td>44</td><td>40</td><td><span>—</span>N/a</td><td>3</td><td>8</td><td>4</td></tr>
<tr><td></td><td>25 Sep</td><td colspan="7">Government issues the betting decree</td></tr>
<tr><td>Real Time<sup>[1]</sup></td><td>30 Sep–2 Oct</td><td>43</td><td>39</td><td>3</td><td>1</td>
    <td>6</td><td>2,000</td><td>4</td></tr>
</table>
"""


def parse():
    parser = _TableParser()
    parser.feed(TABLE)
    return parse_table(parser.tables[0], 2026)


def test_scenarios_of_one_poll_are_grouped():
    polls = parse()
    assert [p.pollster for p in polls] == ["Datafolha", "Real Time"]
    datafolha = polls[0]
    assert datafolha.end_date == date(2026, 9, 30)
    assert datafolha.sample_size == 2506
    assert len(datafolha.scenarios) == 2
    assert datafolha.scenarios[0].values == {
        "Lula PT": 42,
        "F. Bolsonaro PL": 38,
        "Cury Avante": 4,
        "Others": 2,
        "Blank Null Undec.": 7,
    }
    assert "Cury Avante" not in datafolha.scenarios[1].values  # "N/a" is not a number


def test_event_rows_and_footnotes_are_ignored():
    real_time = parse()[1]
    assert real_time.pollster == "Real Time"
    assert real_time.end_date == date(2026, 10, 2)


def test_parse_end_date():
    assert parse_end_date("28–30 Sep", 2026) == date(2026, 9, 30)
    assert parse_end_date("30 Sep–2 Oct", 2026) == date(2026, 10, 2)
    assert parse_end_date("26 Sep", 2026) == date(2026, 9, 26)
    assert parse_end_date("TBD", 2026) is None


def test_year_section_is_found_under_the_round():
    sections = [
        {"toclevel": 1, "line": "First round", "index": "1"},
        {"toclevel": 2, "line": "2026", "index": "4"},
        {"toclevel": 3, "line": "Aug–Oct", "index": "5"},
        {"toclevel": 1, "line": "Second round", "index": "12"},
        {"toclevel": 2, "line": "2026", "index": "14"},
    ]
    assert year_section(sections, "First round", 2026) == "4"
    assert year_section(sections, "Second round", 2026) == "14"
    assert year_section(sections, "Second round", 2025) is None
