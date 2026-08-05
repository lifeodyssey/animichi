"""Top-level pytest plugin declarations.

pytest_plugins in a non-top-level conftest errors under pytest 9 when the
conftest is loaded during collection (i.e. when its directory is not on the
initial anchor->rootdir walk). Shared DB fixtures live in
animichi.tests.conftest_db; declaring them here keeps the eval/integration
conftests collectable under `pytest` with no explicit path args.
"""

pytest_plugins = ("animichi.tests.conftest_db",)
