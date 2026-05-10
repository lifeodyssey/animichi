"""One-time backfill: compute city for existing points using reverse-geocoder.

Usage:
    uv run python -m backend.scripts.backfill_city

Reads all points with city IS NULL, batch reverse-geocodes via GeoNames
K-D tree, and UPDATEs the city column. Safe to run multiple times.
"""

from __future__ import annotations

import asyncio
import os

import asyncpg
import reverse_geocoder as rg  # type: ignore[import-untyped]

DSN = os.environ.get(
    "SUPABASE_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres",
)


async def main() -> None:
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
    try:
        rows = await pool.fetch(
            "SELECT id, latitude, longitude FROM points WHERE city IS NULL"
        )
        if not rows:
            print("No points need backfill.")
            return

        print(f"Backfilling {len(rows)} points...")

        coords = [(float(r["latitude"]), float(r["longitude"])) for r in rows]
        results = rg.search(coords)

        updates = [
            (r["name"], row["id"]) for r, row in zip(results, rows, strict=False)
        ]

        async with pool.acquire() as conn:
            await conn.executemany(
                "UPDATE points SET city = $1 WHERE id = $2",
                updates,
            )

        # Show summary
        cities = {}
        for city, _ in updates:
            cities[city] = cities.get(city, 0) + 1
        print(f"Updated {len(updates)} points across {len(cities)} cities:")
        for city, count in sorted(cities.items(), key=lambda x: -x[1])[:10]:
            print(f"  {city}: {count}")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
