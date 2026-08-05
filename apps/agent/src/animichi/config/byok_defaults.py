"""Named default models for BYOK families that don't require a caller model (OQ-1).

The openai-compatible family always requires an explicit `X-BYOK-Model` (there
is no safe default across arbitrary OpenAI-compatible endpoints). Anthropic
and Gemini ship a well-known official API, so a visible+editable default lets
the settings panel pre-fill a working model without the caller having to know
one.
"""

from __future__ import annotations

from typing import Final

BYOK_ANTHROPIC_DEFAULT_MODEL: Final[str] = "claude-sonnet-4-5"
BYOK_GEMINI_DEFAULT_MODEL: Final[str] = "gemini-2.5-flash"
