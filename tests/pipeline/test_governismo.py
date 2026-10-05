from pipeline.governismo import members, side, term_of


def test_bancadas_become_parties():
    assert members("PT") == ["PT"]
    assert members("Solidaried") == ["SD"]
    assert members("Fdr PT-PCdoB-PV") == ["PT", "PCdoB", "PV"]
    assert members("Bl MdbPsdRepPode") == ["MDB", "PSD", "Republicanos", "PODE"]
    assert members("PpMdbPtb") == ["PP", "MDB", "PTB"]
    assert members("PL/PSL") == ["PL", "PSL"]
    # A cut name drops its cut part; non-parties name nobody.
    assert members("Bl UniPpFdrPsdbCid...") == ["UNIÃO", "PP", "PSDB"]
    assert members("Oposição") == [] and members("GOV.") == []


def test_orientation_sides():
    assert side("Sim") == "S"
    assert side("Não") == "N"
    assert side("Obstrução") == "N"  # the minority's way of voting against
    assert side("Liberado") is None


def test_terms_split_on_the_impeachment():
    assert term_of("2016-05-11") == "dilma2"
    assert term_of("2016-05-12") == "temer"
    assert term_of("2023-02-01") == "lula3"
