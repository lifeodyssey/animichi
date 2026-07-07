"""Infrastructure/client errors.

These errors represent failures talking to external services (HTTP, SDKs, etc.).
They intentionally live outside the domain layer.
"""


class APIError(Exception):
    """Raised when an external API call fails.

    The error_code can be used by callers to translate into specific
    application/domain errors.
    """

    def __init__(self, message: str, *, error_code: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code


class TransientAPIError(APIError):
    """Raised for retryable failures: 5xx responses and transport errors."""
