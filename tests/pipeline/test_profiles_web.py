from pipeline.profiles_web import appointed, elected_before, same_person


def test_birthdays_may_differ_in_one_part_only():
    assert same_person("1984-05-03", "1985-05-03T00:00:00Z")  # a year apart (Anielle Franco)
    assert same_person("1975-06-19", "1975-08-19T00:00:00Z")  # a month apart (Tarcísio de Freitas)
    assert not same_person("1975-06-19", "1976-08-19T00:00:00Z")  # two parts
    assert not same_person("1975-06-19", "1977-06-19T00:00:00Z")  # two years
    assert not same_person(None, "1975-06-19T00:00:00Z")


def pos(title, start=None):
    return {"title": title, "from": start, "to": None}


def test_appointed_offices_are_not_elected_ones():
    minister = {
        "kind": "new",
        "office": "deputado-federal",
        "positions": [pos("ministro da Igualdade Racial do Brasil", 2023)],
    }
    assert appointed(minister)
    assert elected_before(minister) is None
    director = {"kind": "new", "office": "deputado-federal", "positions": [pos("diretor")]}
    assert not appointed(director)


def test_elected_offices_the_tse_files_miss_count_as_a_career():
    old_senator = {
        "kind": "new",
        "office": "deputado-federal",
        "positions": [pos("senador do Rio Grande do Sul", 2003)],
    }
    assert elected_before(old_senator) == "other-office"
    back = {"kind": "new", "office": "senador", "positions": [pos("senador do Paraná", 2011)]}
    assert elected_before(back) == "returning"
    # The mandate held now is not "before".
    current = {"kind": "new", "office": "senador", "positions": [pos("senador do Paraná", 2023)]}
    assert elected_before(current) is None
