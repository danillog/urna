from pathlib import Path

import pytest

from pipeline.pollsters import PollsterRegistry

REGISTRY = PollsterRegistry.load(Path(__file__).resolve().parents[2] / "data" / "pollsters.yaml")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Genial/Quaest", "Quaest"),
        ("IPEC", "Ipec"),
        ("Atlas/Intel", "AtlasIntel"),
        ("Vox Brasil", "Vox Brasil"),
        ("Vox Populi", "Vox Populi"),
        ("Real Time Big Data", "Real Time Big Data"),
        ("Instituto Local ", "Instituto Local"),
    ],
)
def test_normalize(raw, expected):
    assert REGISTRY.normalize(raw) == expected


def test_methods_only_lists_confirmed_pollsters():
    methods = REGISTRY.methods()
    assert methods["Datafolha"] == "in_person"
    assert methods["AtlasIntel"] == "online"
    assert "Gerp" not in methods


def test_unknown_method_is_rejected(tmp_path):
    path = tmp_path / "pollsters.yaml"
    path.write_text("- { name: X, match: x, method: carrier_pigeon }\n")
    with pytest.raises(ValueError, match="carrier_pigeon"):
        PollsterRegistry.load(path)
