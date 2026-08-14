import asyncpg


# ruleid: py-no-direct-driver-client
async def connect():
    return await asyncpg.connect("postgres://...")
