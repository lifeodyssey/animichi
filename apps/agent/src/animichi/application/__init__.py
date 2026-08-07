"""Application layer.

Use cases (``handle_user_message``) and shared application-level error
vocabulary (``errors``) live here. The layer is framework-independent: it
must not import FastAPI/PydanticAI or the ``clients/`` HTTP adapter. The
``agents/`` package is the framework adapter that wires these use cases to
the PydanticAI runtime (see ``agents/README.md``).
"""
