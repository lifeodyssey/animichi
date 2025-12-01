"""Translation tool for bangumi titles using Gemini LLM.

This module defines an async translation function and wraps it in a
FunctionTool so it can be used by ADK LlmAgents. It is intentionally
kept stateless and side-effect free (other than logging), following
ADK best practices for tools.
"""

from google.adk.tools import FunctionTool
from google.generativeai import GenerativeModel

from utils.logger import get_logger

logger = get_logger(__name__)


async def translate_text(
    text: str,
    target_language: str,
    context: str = "anime title",
) -> dict:
    """Translate text to target language using Gemini.

    Args:
        text: Text to translate (usually Japanese bangumi title).
        target_language: Target language code (zh-CN, en, ja, etc.).
        context: Context hint for better translation (default: "anime title").

    Returns:
        {
            "original": str,
            "translated": str,
            "target_language": str,
            "success": bool,
            "error": str | None,
        }
    """
    try:
        if target_language == "ja":
            # No-op for Japanese: return original text directly.
            return {
                "original": text,
                "translated": text,
                "target_language": target_language,
                "success": True,
                "error": None,
            }

        # Use Gemini to perform translation. Keep model name aligned with the
        # rest of the project (non-experimental variant).
        model = GenerativeModel("gemini-2.0-flash")

        prompt = f"""Translate the following {context} to {target_language}:

Original: {text}

Requirements:
- Provide natural, fluent translation
- For anime titles, use official translations if known
- Preserve meaning and tone
- Return ONLY the translated text, no explanations

Translation:"""

        response = model.generate_content(prompt)
        translated = (response.text or "").strip()

        logger.info(
            "Translation completed",
            original=text,
            translated=translated,
            target_language=target_language,
        )

        return {
            "original": text,
            "translated": translated,
            "target_language": target_language,
            "success": True,
            "error": None,
        }

    except Exception as exc:  # pragma: no cover - defensive logging path
        logger.error(
            "Translation failed",
            text=text,
            target_language=target_language,
            error=str(exc),
            exc_info=True,
        )
        # Fallback: return original text so the agent can continue.
        return {
            "original": text,
            "translated": text,
            "target_language": target_language,
            "success": False,
            "error": str(exc),
        }


# Expose as an ADK FunctionTool for use by LlmAgents.
translate_tool = FunctionTool(translate_text)
