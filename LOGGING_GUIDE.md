# Logging Guide

## Overview

This project uses a structured logging stack based on `structlog` and `rich`.
Logs are:
- machine-readable (key/value pairs)
- human-friendly in the console
- consistent across agents, tools, and infrastructure layers.

Use this guide when you need to:
- understand what the workflow is doing
- debug API or agent issues
- investigate latency or performance problems.

---

## Quick Start

### 1. Configure log level

Edit `.env` in the project root:

```bash
# Development: show verbose logs
LOG_LEVEL=DEBUG
DEBUG=true

# Production: only important information
LOG_LEVEL=INFO
DEBUG=false
```

### 2. Log levels

| Level      | Typical use            | What you see                                                       |
|-----------|------------------------|--------------------------------------------------------------------|
| `DEBUG`   | Local development      | Internal operations, API requests/responses, callsites, timings    |
| `INFO`    | Normal production      | Workflow progress, major events, step completion                   |
| `WARNING` | Non-fatal issues       | Degraded behavior, configuration problems, soft failures           |
| `ERROR`   | Failures               | Exceptions, stack traces, full error context                       |

### 3. Enabling debug logging

For active debugging, turn on DEBUG mode:

```bash
echo "LOG_LEVEL=DEBUG" >> .env
echo "DEBUG=true" >> .env

# or copy the template first
cp .env.example .env

# then run the agent
make run
```

---

## What Gets Logged

### 1. Workflow step tracing

Every major workflow step logs start/complete markers with timing:

```text
============================================================
[ORCHESTRATOR] Starting pilgrimage workflow
  session_id: session-abc123
  bangumi_id: 12345

============================================================
[STEP 1/4] Searching bangumi points
  session_id: session-abc123
  bangumi_id: 12345

[COMPLETE] SearchAgent (bangumi mode)
  duration_seconds: 1.234
  session_id: session-abc123

[STEP 1/4] ✓ Points retrieved successfully
  points_count: 15
  user_location: Shinjuku Station
```

### 2. Performance timing

Each major operation records `duration_seconds`:

```text
[START] RouteAgent
  operation: RouteAgent
  session_id: session-abc123

[COMPLETE] RouteAgent
  operation: RouteAgent
  duration_seconds: 2.456
  session_id: session-abc123
```

This makes it easy to see which step is slow.

### 3. Error diagnosis

Error logs always include structured context and stack traces:

```text
[ORCHESTRATOR] ✗ Pilgrimage workflow failed
  error: No pilgrimage points found
  error_type: RuntimeError
  session_id: session-abc123
  bangumi_id: 12345
  points_retrieved: 0

Traceback (most recent call last):
  ...
  RuntimeError: No pilgrimage points found for selected anime
```

### 4. Third‑party libraries

When `LOG_LEVEL=DEBUG`, additional logs appear from:
- **httpx** – request/response details for HTTP calls
- **google.auth** – Google API authentication flow
- **google.api_core** – Google Maps client calls

---

## Troubleshooting

### Problem 1: Logs are too sparse

Symptom: Only a few high-level messages appear.

Check your `.env`:

```bash
grep LOG_LEVEL .env
grep DEBUG .env
```

You should see:

```text
LOG_LEVEL=DEBUG
DEBUG=true
```

If not, update the values and restart the app.

### Problem 2: Not sure which step failed

Turn on DEBUG logging. Each step is clearly labeled:

```text
[STEP 0/4] ✓ Bangumi resolved successfully
[STEP 1/4] ✓ Points retrieved successfully
[STEP 2/4] ✗ WeatherAgent failed (non‑critical)
[STEP 3/4] ✓ Route optimized
[STEP 4/4] ✓ Transport optimized
```

Use these markers to jump directly to the failing stage.

### Problem 3: Third‑party API failures

Enable DEBUG and inspect the httpx entries:

```text
[httpx] POST https://maps.googleapis.com/...
[httpx] Headers: {...}
[httpx] Request body: {...}
[httpx] Response: 403 Forbidden
```

Then confirm your API keys:

```bash
grep API_KEY .env
```

### Problem 4: Finding performance bottlenecks

Look for large `duration_seconds` values:

```text
[COMPLETE] SearchAgent (bangumi mode)
  duration_seconds: 0.234

[COMPLETE] RouteAgent
  duration_seconds: 15.678   # this is slow
```

Focus optimization efforts on the slowest operations first.

---

## Testing the Logging Setup

Run a small test script to verify the configuration:

```bash
uv run python test_logging.py
```

You should see:
- messages at different levels (DEBUG, INFO, WARNING, ERROR)
- structured fields (e.g., `session_id`, `points_count`)
- step markers (`[STEP 1/3]`, `[STEP 2/3]`, …)
- timing fields such as `duration_seconds`
- stack traces for simulated errors.

---

## Recommended Settings

### Development

```bash
LOG_LEVEL=DEBUG
DEBUG=true
APP_ENV=development
```

- see all internal details
- quickly locate problems
- understand each step of the workflow

### Production

```bash
LOG_LEVEL=INFO
DEBUG=false
APP_ENV=production
```

- reduced log noise
- focus on important events
- good performance while preserving enough context to debug issues

---

## Summary

With the enhanced logging system you can:
- quickly pinpoint failures through clear step markers and error context
- analyze performance via per-step timings
- trace external API calls
- adjust verbosity with simple `.env` changes.

When something goes wrong, first enable DEBUG logs, reproduce the issue, and
use the structured output to follow the workflow from start to failure. 
