"""HTTP clients for external services.

The runtime read path is catalog-only: the agent talks to the Catalog
service through :mod:`agent.clients.catalog_client` (httpx). Seed scripts
use their own scripts-local helpers under ``agent/scripts/``.
"""

from agent.clients.catalog_client import CatalogClient, CatalogClientProtocol

__all__ = [
    "CatalogClient",
    "CatalogClientProtocol",
]
