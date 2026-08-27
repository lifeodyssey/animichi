"""Logging configuration using structlog."""

from typing import cast

import structlog
from structlog.typing import FilteringBoundLogger


def get_logger(name: str, **kwargs: object) -> FilteringBoundLogger:
    """
    Get a structured logger instance.

    Args:
        name: Logger name (usually __name__)
        **kwargs: Additional context to bind to logger

    Returns:
        Configured structlog BoundLogger
    """
    logger = structlog.get_logger(name)

    if kwargs:
        logger = logger.bind(**kwargs)

    return cast(FilteringBoundLogger, logger)
