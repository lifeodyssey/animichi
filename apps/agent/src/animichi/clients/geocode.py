"""Typed geocoding models mirrored from the Catalog contract."""

from enum import StrEnum

from pydantic import BaseModel, Field


class GeocodeKind(StrEnum):
    """Kinds of gazetteer entries returned by the Catalog service."""

    STATION = "station"
    CITY = "city"
    WARD = "ward"
    LANDMARK = "landmark"
    PREFECTURE = "prefecture"


class GeocodeSource(StrEnum):
    """Auditable source families for gazetteer entries."""

    SEED = "seed"
    MLIT = "mlit"
    GEONAMES = "geonames"
    MANUAL = "manual"


class GeocodeCandidate(BaseModel):
    """One typed place-name candidate from the local gazetteer."""

    id: str
    label: str
    name: str
    lat: float
    lng: float
    kind: GeocodeKind
    source: GeocodeSource
    effective_radius_m: int | None = Field(default=None, gt=0)
