import structlog
from structlog import testing

from agent.utils.logger import get_logger


def test_get_logger_binds_extra_kwargs() -> None:
    structlog.contextvars.clear_contextvars()
    logger = get_logger("test_logger_bind", request_id="abc")

    with testing.capture_logs() as captured:
        logger.info("hello")

    assert captured[0]["request_id"] == "abc"


def test_get_logger_without_kwargs_binds_nothing_extra() -> None:
    structlog.contextvars.clear_contextvars()
    logger = get_logger("test_logger_no_bind")

    with testing.capture_logs() as captured:
        logger.info("hello")

    assert "request_id" not in captured[0]


def test_get_logger_bindings_are_independent_per_call() -> None:
    structlog.contextvars.clear_contextvars()
    logger_a = get_logger("test_logger_a", request_id="a")
    logger_b = get_logger("test_logger_b", request_id="b")

    with testing.capture_logs() as captured:
        logger_a.info("from-a")
        logger_b.info("from-b")

    assert captured[0]["request_id"] == "a"
    assert captured[1]["request_id"] == "b"
