# Seichijunrei Bot – Local Setup Guide

> How to configure, run and troubleshoot Seichijunrei Bot on your machine

---

## Table of Contents

- [Required API keys](#required-api-keys)
- [Configuration steps](#configuration-steps)
- [Running locally](#running-locally)
- [Testing and validation](#testing-and-validation)
- [API key acquisition tips](#api-key-acquisition-tips)
- [Troubleshooting](#troubleshooting)

---

## Required API Keys

### Core keys

| API key              | Purpose                           | Required | Notes                                        |
|----------------------|-----------------------------------|----------|----------------------------------------------|
| `GOOGLE_MAPS_API_KEY`| Geocoding, distance, directions   | ✅ Yes   | Used for station lookup and route planning   |
| `WEATHER_API_KEY`    | Weather API (OpenWeatherMap)      | ⚠️ Optional | Only needed if you want weather in the PDF |

> Note: Earlier versions of this project used Gemini directly from Python and
> required `GEMINI_API_KEY`. All LLM calls now happen inside ADK / Agent
> Engine, so local Python code no longer needs a Gemini key.

### Dependency summary

#### `GOOGLE_MAPS_API_KEY` (required)

Used by:
- Search/location resolution – station name → GPS coordinates
- Route optimisation – distances and travel times between points
- Transport suggestions – walking / transit recommendations

This key is mandatory; without it, the core route planning features cannot run.

Source:
- Google Cloud Console → Maps Platform.

#### `WEATHER_API_KEY` (optional)

Used by:
- `WeatherAgent` – current or forecast conditions and basic advice.

If you omit this key:
- the system still runs normally
- weather fields in the PDF will simply be left empty.

Recommended source:
- [OpenWeatherMap](https://openweathermap.org/api).

---

## Configuration Steps

### 1. Create the environment file

From the project root:

```bash
cp .env.example .env
```

### 2. Edit `.env`

Use any editor you like:

```bash
code .env      # VS Code
# or
open .env      # macOS default editor
```

### 3. Fill in API keys

Minimal configuration (only core route planning):

```env
# Required – maps and routing
GOOGLE_MAPS_API_KEY=your_actual_key

ANITABI_API_URL=https://api.anitabi.cn/bangumi
APP_ENV=development
LOG_LEVEL=INFO
DEBUG=false
```

Full configuration (includes weather):

```env
# Required
GOOGLE_MAPS_API_KEY=your_actual_key

# Optional – weather
WEATHER_API_KEY=your_openweathermap_key
WEATHER_API_URL=https://api.openweathermap.org/data/2.5

# Other settings
ANITABI_API_URL=https://api.anitabi.cn/bangumi
APP_ENV=development
LOG_LEVEL=INFO
DEBUG=false
MAX_RETRIES=3
TIMEOUT_SECONDS=30
CACHE_TTL_SECONDS=3600
USE_CACHE=true
OUTPUT_DIR=outputs
TEMPLATE_DIR=templates
```

### 4. Validate configuration

Run a quick validation script:

```bash
uv run python -c "from config.settings import get_settings; s = get_settings(); print('Missing keys:', s.validate_api_keys())"
```

or use the built‑in health check:

```bash
make health
```

Expected output (example):

```text
Missing keys: []             # empty list means all required keys are set

Startup Check Result: OK
  ✅ agents: healthy
  ✅ tools: healthy
  ✅ domain: healthy
```

---

## Running Locally

### Option 1 – ADK Web UI (recommended)

Start the web interface with chat UI:

```bash
make dev    # first time only – installs dev tools and Playwright
make web    # start ADK Web UI
```

This is equivalent to:

```bash
uv run adk web adk_agents
```

After startup:

1. The terminal prints a URL, typically `http://localhost:8000`.
2. Open it in your browser.
3. You should see a chat‑style interface similar to ChatGPT.
4. Type a message to start planning a pilgrimage.

Example conversation:

```text
User: I am at Shinjuku Station and want to visit locations from Makoto Shinkai works.
Bot: Great! I will plan an anime pilgrimage route for you.
     First I will search for pilgrimage spots around Shinjuku Station...

     I found pilgrimage locations for:
     - Your Name (15 locations)
     - Weathering With You (12 locations)
     - The Garden of Words (8 locations)

     Which of these works would you like to include?
```

### Option 2 – Command‑line interface

Run the agent in a terminal:

```bash
make run
```

or directly:

```bash
uv run adk run adk_agents/seichijunrei_bot
```

This starts an interactive CLI where you can type queries and see the agent’s
responses in the console.

---

## Testing and Validation

### 1. Health check

Verify that core components are wired correctly:

```bash
make health
```

This runs `health.py` and checks that clients, tools and domain models can be
imported and initialised.

### 2. Unit tests

Run the unit test suite (using mostly mocked data):

```bash
make test
```

Run all tests, including integration tests that may call real APIs:

```bash
make test-all
```

If you only want unit tests with coverage:

```bash
make test-cov
```

> Tip: integration tests may require real API keys and can be slow; start with
> unit tests only when iterating locally.

---

## API Key Acquisition Tips

### Google Maps Platform

1. Create or select a project in Google Cloud Console.
2. Enable:
   - Geocoding API
   - Directions API
3. Create an API key and copy it into `GOOGLE_MAPS_API_KEY`.
4. For local development you can temporarily set:
   - Application restrictions: **None**
   - API restrictions: **Don’t restrict key**

Remember to tighten restrictions before deploying to production.

### OpenWeatherMap

1. Sign up at [OpenWeatherMap](https://openweathermap.org/api).
2. Create an API key.
3. Put it into `.env` as `WEATHER_API_KEY`.

---

## Troubleshooting

### Problem 1 – “Weather API key not provided – using limited mode”

This is a warning, not an error.

- The workflow still runs.
- The generated PDF simply omits weather details.
- If you do not care about weather, you can safely ignore this message.

To enable weather later:

1. Obtain an OpenWeatherMap API key.
2. Add `WEATHER_API_KEY=your_key` to `.env`.
3. Restart the app.

### Problem 2 – ADK Web UI not reachable

Possible causes:

- Port 8000 already in use.
- Local firewall is blocking access.
- Startup failed due to configuration.

Steps to investigate:

```bash
# Check if port 8000 is in use
lsof -i :8000

# Start on a different port if needed
uv run adk web adk_agents --port 8080
```

Enable more verbose logs:

```bash
LOG_LEVEL=DEBUG make web
```

On macOS, also check firewall settings under:
System Settings → Network → Firewall.

### Problem 3 – Playwright / Chromium install failures

PDF generation relies on a Playwright‑managed Chromium build.

Try installing manually:

```bash
uv run playwright install chromium
```

If downloads are slow or blocked, point Playwright to a mirror:

```bash
export PLAYWRIGHT_DOWNLOAD_HOST=https://playwright.azureedge.net
uv run playwright install chromium
```

If installation still fails:
- You can continue using route planning and map generation without PDFs.

### Problem 4 – Google Maps “REQUEST_DENIED”

Likely causes:

1. Invalid or inactive API key.
2. Required APIs not enabled.
3. IP/domain restrictions blocking local requests.
4. Quota or billing issues.

Basic checks:

```bash
curl "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo&key=YOUR_API_KEY"
```

You should see JSON, not an error.

In Google Cloud Console:

- Ensure Geocoding API and Directions API are **enabled**.
- Temporarily remove key restrictions for local testing.
- Check quota usage on the “Quotas” tab for each API.

### Problem 5 – “No anime data found”

Possible reasons:

- Anitabi API is temporarily unavailable.
- The chosen area has no registered pilgrimage locations.
- Network connectivity issues.

Try:

```bash
curl "https://api.anitabi.cn/bangumi/list?page=1&limit=10"
```

You should see a JSON list of works.

If API calls work, try a well‑known area such as “Shinjuku Station” or
“Kyoto Station”. You can also adjust the search radius in
`config/settings.py`.

### Problem 6 – Tests failing across the board

Common causes:

- Dependencies not installed or broken virtual environment.
- Missing `.env` or invalid values.

Try:

```bash
make clean
make dev
make test
```

If integration tests fail due to missing network or keys, run only unit tests:

```bash
uv run pytest tests/unit/ -v -m "not integration"
```

---

## Quick Start Checklist

Before you start using Seichijunrei Bot locally, confirm:

- [ ] `uv` is installed.
- [ ] `GOOGLE_MAPS_API_KEY` is configured and required Maps APIs are enabled.
- [ ] (Optional) `WEATHER_API_KEY` is configured for weather data.
- [ ] `.env` exists in the project root.
- [ ] `make dev` has been run at least once.
- [ ] `make health` reports “OK”.
- [ ] `make web` starts the ADK Web UI and you can open `http://localhost:8000`.

If all boxes are checked, you are ready to start planning anime pilgrimage
routes with Seichijunrei Bot. 🎉

