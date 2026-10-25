from pipeline.refresh import STEPS, plan


def test_light_run_skips_heavy_steps_and_ends_with_the_dataset():
    light = plan(False)
    assert not any(s.heavy for s in light)
    assert ("pipeline.profiles_web", ("--news-only",)) in [(s.module, s.args) for s in light]
    assert light[-1].module == "pipeline.build"


def test_full_run_has_every_step_once_and_no_separate_news_run():
    full = plan(True)
    assert len(full) == len(STEPS) - 1
    assert all(s.args != ("--news-only",) for s in full)
    # The map is rebuilt after its 2026 results are read, and the dataset comes last.
    modules = [s.module for s in full]
    assert modules.index("pipeline.fetch_tse_results") < modules.index("pipeline.municipal_map")
    assert modules[-1] == "pipeline.build"
