"""Compatibility entry point for the current CodeMode rematch runner."""

from __future__ import annotations

import asyncio

from agent.spikes.codemode.rematch import main

if __name__ == "__main__":
    asyncio.run(main())
