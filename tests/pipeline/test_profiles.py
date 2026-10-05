from pipeline.profiles import kind_of, plain, result_of, socials, title


def test_results_read_as_the_tse_writes_them():
    assert result_of({"DS_SIT_TOT_TURNO": "ELEITO POR QP"}) == "elected"
    assert result_of({"DS_SIT_TOT_TURNO": "ELEITO POR MÉDIA"}) == "elected"
    assert result_of({"DS_SIT_TOT_TURNO": "2º TURNO"}) == "runoff"
    assert result_of({"DS_SIT_TOT_TURNO": "SUPLENTE"}) == "substitute"
    assert result_of({"DS_SIT_TOT_TURNO": "NÃO ELEITO"}) == "lost"
    assert result_of({"DS_SIT_TOT_TURNO": "#NULO#"}) == "unfit"
    # The file's "not elected" for an unfit registration is not a lost vote.
    assert result_of({"DS_SIT_TOT_TURNO": "NÃO ELEITO", "DS_SITUACAO_CANDIDATURA": "INAPTO"}) == "unfit"


def test_kind_of_career():
    won = lambda office: {"office": office, "result": "elected"}  # noqa: E731
    lost = {"office": "vereador", "result": "lost"}
    assert kind_of("deputado-federal", []) == "new"
    assert kind_of("deputado-federal", [lost]) == "tried"
    assert kind_of("deputado-federal", [lost, won("vereador")]) == "other-office"
    assert kind_of("deputado-federal", [won("vereador"), won("deputado-federal")]) == "returning"


def test_social_links_are_named_and_complete():
    assert socials(["instagram.com/fulano", "https://x.com/fulano", "", "https://fulano.com.br"]) == [
        {"network": "Instagram", "url": "https://instagram.com/fulano"},
        {"network": "X", "url": "https://x.com/fulano"},
        {"network": "Site", "url": "https://fulano.com.br"},
    ]


def test_names_match_without_accents_or_punctuation():
    assert plain("José  d'Ávila-Júnior") == "JOSE D AVILA JUNIOR"


def test_place_names_keep_their_small_words():
    assert title("RIO DE JANEIRO") == "Rio de Janeiro"
    assert title("SANTA BÁRBARA D'OESTE") == "Santa Bárbara d'Oeste"
    assert title("JHC") == "JHC"
    assert title("NIKOLAS FERREIRA") == "Nikolas Ferreira"
