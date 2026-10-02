from pipeline.build import OUTPUT, build_dataset, serialize


def test_dataset_builds_from_repository_data():
    dataset = build_dataset()
    assert set(dataset["presidential"]) == {"2010", "2014", "2018", "2022", "2026"}
    assert len(dataset["states"]) == 27
    race = dataset["presidential"]["2022"]["rounds"]["r2"]
    assert race["winner"] == "Lula"
    assert race["accuracy"], "past elections must rank pollsters"


def test_committed_dataset_is_up_to_date():
    assert OUTPUT.read_text(encoding="utf-8") == serialize(build_dataset()), "run `npm run data`"
