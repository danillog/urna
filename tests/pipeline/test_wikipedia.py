from datetime import date

from pipeline.sources.wikipedia import (
    _TableParser,
    parse_end_date,
    parse_number,
    parse_polls,
    parse_table,
    split_sections,
    year_section,
)

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


# Trimmed copy of a Portuguese state page ("Pesquisas eleitorais para a eleição estadual de 2026 em ...").
PT_PAGE = """
<div class="mw-heading mw-heading2"><h2 id="p">Primeiro turno (governador)</h2></div>
<div class="mw-heading mw-heading3"><h3 id="a">Setembro – Outubro</h3></div>
<table>
<tr><th rowspan="3">Contratante/Pesquisa</th><th rowspan="3">Datas de Pesquisa</th>
    <th rowspan="3">Amostragem</th><th rowspan="3">Margem de erro (%pt)</th><th rowspan="3">Cen.</th>
    <th></th><th></th><th rowspan="3">Outros</th><th rowspan="3">Indecisos ou Absentos</th></tr>
<tr><th>Tarcísio<br>REPUBLICANOS</th><th>Haddad<br>PT</th></tr>
<tr><th></th><th></th></tr>
<tr><td>DataFolha<sup>[23]</sup></td><td>28 Set – 30 Set</td><td>1 610</td><td>2,0</td><td>1</td>
    <td>50%</td><td>33,5%</td><td>—</td><td>10%</td></tr>
</table>
<div class="mw-heading mw-heading3"><h3 id="b">2025</h3></div>
<table>
<tr><th rowspan="3">Contratante/Pesquisa</th><th rowspan="3">Datas de Pesquisa</th>
    <th rowspan="3">Amostragem</th><th rowspan="3">Margem de erro (%pt)</th><th></th><th></th>
    <th rowspan="3">Indecisos ou Absentos</th></tr>
<tr><th>Tarcísio<br>REPUBLICANOS</th><th>Haddad<br>PT</th></tr>
<tr><th></th><th></th></tr>
<tr><td>Real Time Big Data</td><td>2 a 3 de outubro</td><td>1.500</td><td>2,5</td><td>52%</td><td>30%</td>
    <td>11%</td></tr>
</table>
<div class="mw-heading mw-heading2"><h2 id="s">Senador</h2></div>
"""


def test_portuguese_tables():
    sections = split_sections(PT_PAGE)
    assert [name for name, _ in sections] == ["Primeiro turno (governador)", "Senador"]
    datafolha, real_time = parse_polls(sections[0][1], 2026, decimal_comma=True)
    assert (datafolha.pollster, datafolha.end_date, datafolha.sample_size) == (
        "DataFolha",
        date(2026, 9, 30),
        1610,
    )
    # The scenario number ("Cen.") and the margin of error are not candidates.
    assert datafolha.scenarios[0].values == {
        "Tarcísio REPUBLICANOS": 50,
        "Haddad PT": 33.5,
        "Indecisos ou Absentos": 10,
    }
    # The year comes from the subheading.
    assert (real_time.end_date, real_time.sample_size) == (date(2025, 10, 3), 1500)


def test_parse_end_date_in_portuguese():
    assert parse_end_date("28 a 30 de setembro", 2026) == date(2026, 9, 30)
    assert parse_end_date("29 e 30 de setembro", 2026) == date(2026, 9, 30)
    assert parse_end_date("28 de agosto a 9 de setembro", 2026) == date(2026, 9, 9)
    assert parse_end_date("29 Set – 1 Out", 2026) == date(2026, 10, 1)
    assert parse_end_date("4 a 7 de dezembro de 2025", 2026) == date(2025, 12, 7)


def test_parse_number_with_decimal_comma():
    assert parse_number("57,3%", decimal_comma=True) == 57.3
    assert parse_number("1 600", decimal_comma=True) == 1600
    assert parse_number("1.600", decimal_comma=True) == 1600
    assert parse_number("<1%", decimal_comma=True) is None
    assert parse_number("2,506") == 2506
