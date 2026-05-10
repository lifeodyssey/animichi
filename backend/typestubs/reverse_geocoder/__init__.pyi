"""Type stubs for reverse_geocoder package."""

from typing import TypedDict

class _GeoResult(TypedDict):
    lat: str
    lon: str
    name: str
    admin1: str
    admin2: str
    cc: str

def search(
    geo_coords: list[tuple[float, float]],
    mode: int = ...,
    verbose: bool = ...,
) -> list[_GeoResult]: ...
