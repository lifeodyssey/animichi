#!/usr/bin/env bash
set -euo pipefail

# Production apex SEO verification (#914) — re-runnable, read-only.
#
# Checks the canonical origin (https://animichi.com) for the full P6 SEO
# surface after the #914 launch: sitemap / robots / og-image / home JSON-LD /
# hreflang / IndexNow, plus the activation-level assertions that the apex is
# really the web Worker (HTML home, www 301, edge-only /v1) and not the edge
# Worker's JSON 404.
#
# Safe to run BEFORE activation: every failure is reported with an exit code,
# so a pre-launch dry run is expected to fail the www/apex-html checks. Run it
# again after `webRoutesEnabled` lands and every check must be green.
#
# Usage:
#   bash scripts/verify-prod-seo.sh            # full post-activation check
#   bash scripts/verify-prod-seo.sh <origin>   # check a different origin
#                                             # (e.g. a preview host, read-only)
#
# Requires: curl, python3 (dig is used only for an informational DNS note).
# The IndexNow key is read from apps/web/src/features/seo/indexnow.ts — the
# checked-in source constant is the single source of truth, never hardcoded.

ORIGIN="${1:-https://animichi.com}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
fail() { echo "✗ $*" >&2; FAIL=$((FAIL + 1)); }
ok() { echo "✓ $*"; PASS=$((PASS + 1)); }
warn() { echo "⚠ $*" >&2; }

command -v curl >/dev/null || { echo "✗ curl not found" >&2; exit 2; }
command -v python3 >/dev/null || { echo "✗ python3 not found" >&2; exit 2; }

HTTP_CODE="$(mktemp "$TMP/http.XXXXXX")"
fetch() { # fetch <outfile> <url> — stores the HTTP status in $HTTP_CODE
  curl -fsSL --max-time 20 -o "$1" -w '%{http_code}' "$2" > "$HTTP_CODE" 2>/dev/null \
    || true
}

echo "== Verifying SEO surface at $ORIGIN =="

# ── Informational: DNS state (not a pass/fail check) ─────────────────────────
if command -v dig >/dev/null 2>&1; then
  warn "DNS: $(dig +short "$(echo "$ORIGIN" | sed -E 's#^https?://##')" A | tr '\n' ' ' | sed 's/ $//' || echo 'no A record yet')"
fi

# ── 1. Home page: HTML from the web Worker, not the edge JSON 404 ────────────
fetch "$TMP/home.html" "$ORIGIN/"
CODE="$(cat "$HTTP_CODE")"
if [ "$CODE" != "200" ]; then
  fail "home $ORIGIN/ → HTTP $CODE (expected 200)"
else
  if grep -q "<html" "$TMP/home.html"; then
    ok "home serves HTML (web Worker owns the apex)"
  elif grep -q '"error"' "$TMP/home.html"; then
    fail "home answers the edge Worker's JSON error — routes not narrowed yet"
  else
    fail "home returned 200 but no <html> marker found"
  fi
fi

# ── 2. robots.txt ────────────────────────────────────────────────────────────
fetch "$TMP/robots.txt" "$ORIGIN/robots.txt"
if [ "$(cat "$HTTP_CODE")" != "200" ]; then
  fail "robots.txt → HTTP $(cat "$HTTP_CODE") (expected 200)"
elif ! grep -q "Sitemap: $ORIGIN/sitemap.xml" "$TMP/robots.txt" \
  || ! grep -q "Disallow: /v1/" "$TMP/robots.txt"; then
  fail "robots.txt missing 'Sitemap: $ORIGIN/sitemap.xml' or 'Disallow: /v1/'"
else
  ok "robots.txt serves sitemap pointer + /v1/ disallow"
fi

# ── 3. sitemap.xml ───────────────────────────────────────────────────────────
fetch "$TMP/sitemap.xml" "$ORIGIN/sitemap.xml"
if [ "$(cat "$HTTP_CODE")" != "200" ]; then
  fail "sitemap.xml → HTTP $(cat "$HTTP_CODE") (expected 200)"
elif ! grep -q "<urlset" "$TMP/sitemap.xml" \
  || ! grep -q "<loc>$ORIGIN/</loc>" "$TMP/sitemap.xml" \
  || ! grep -q 'hreflang="x-default"' "$TMP/sitemap.xml"; then
  fail "sitemap.xml is not a valid urlset with $ORIGIN/ + hreflang alternates"
else
  ok "sitemap.xml is a valid urlset with apex loc + hreflang"
fi

# ── 4. og-image.png (magic + 1200x630 dimensions) ────────────────────────────
fetch "$TMP/og.png" "$ORIGIN/og-image.png"
if [ "$(cat "$HTTP_CODE")" != "200" ]; then
  fail "og-image.png → HTTP $(cat "$HTTP_CODE") (expected 200)"
else
  DIMS="$(python3 - "$TMP/og.png" <<'PY'
import struct, sys
data = open(sys.argv[1], "rb").read()
if data[:8] != b"\x89PNG\r\n\x1a\n":
    sys.exit(1)
w, h = struct.unpack(">II", data[16:24])
print(f"{w}x{h}")
PY
  )" || DIMS=""
  if [ "$DIMS" = "1200x630" ]; then
    ok "og-image.png is a 1200x630 PNG"
  else
    fail "og-image.png wrong or not a PNG (got '${DIMS:-invalid}')"
  fi
fi

# ── 5. Home JSON-LD: WebSite + Organization on $ORIGIN/ ──────────────────────
if [ ! -s "$TMP/home.html" ]; then
  fail "home not fetched — cannot verify JSON-LD"
else
JSONLD="$(python3 - "$TMP/home.html" "$ORIGIN" <<'PY'
import json, re, sys
html, origin = open(sys.argv[1], encoding="utf-8").read(), sys.argv[2]
found = re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S)
nodes = []
for block in found:
    try:
        data = json.loads(block)
    except json.JSONDecodeError:
        continue
    nodes.extend(data if isinstance(data, list) else [data])
def walk(node):
    yield node
    if isinstance(node, dict):
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)
types = [n.get("@type") for n in walk(nodes) if isinstance(n, dict)]
site = next((n for n in walk(nodes) if isinstance(n, dict) and n.get("@type") == "WebSite"), None)
org = next((n for n in walk(nodes) if isinstance(n, dict) and n.get("@type") == "Organization"), None)
ok_site = bool(site and site.get("url") == f"{origin}/" and site.get("potentialAction"))
ok_org = bool(org and org.get("url") == f"{origin}/" and org.get("logo"))
print(json.dumps({"site": ok_site, "org": ok_org, "types": types}))
PY
)"
SITE_OK="$(echo "$JSONLD" | python3 -c 'import json,sys; print(json.load(sys.stdin)["site"])')"
ORG_OK="$(echo "$JSONLD" | python3 -c 'import json,sys; print(json.load(sys.stdin)["org"])')"
if [ "$SITE_OK" = "True" ] && [ "$ORG_OK" = "True" ]; then
  ok "home JSON-LD has WebSite (with SearchAction) + Organization (with logo)"
else
  fail "home JSON-LD incomplete — site=$SITE_OK org=$ORG_OK (expected WebSite + Organization)"
fi
fi

# ── 6. hreflang + canonical on the home page ─────────────────────────────────
if [ ! -s "$TMP/home.html" ]; then
  fail "home not fetched — cannot verify hreflang/canonical"
else
HREFLANG_OK=1
for HL in ja zh en x-default; do
  grep -q "hreflang=\"$HL\" href=\"$ORIGIN/\"" "$TMP/home.html" || HREFLANG_OK=0
done
grep -q "rel=\"canonical\" href=\"$ORIGIN/\"" "$TMP/home.html" || HREFLANG_OK=0
if [ "$HREFLANG_OK" = "1" ]; then
  ok "home head has canonical + ja/zh/en/x-default hreflang alternates"
else
  fail "home head missing canonical or one of ja/zh/en/x-default hreflang"
fi
fi

# ── 7. IndexNow key file (key read from the checked-in constant) ─────────────
KEY="$(sed -n 's/.*INDEXNOW_KEY = "\([0-9a-f]\{32\}\)".*/\1/p' \
  "$REPO_ROOT/apps/web/src/features/seo/indexnow.ts" | head -1)"
if [ -z "$KEY" ]; then
  fail "cannot read INDEXNOW_KEY from apps/web/src/features/seo/indexnow.ts"
else
  fetch "$TMP/indexnow.txt" "$ORIGIN/$KEY.txt"
  if [ "$(cat "$HTTP_CODE")" != "200" ]; then
    fail "IndexNow key file /$KEY.txt → HTTP $(cat "$HTTP_CODE") (expected 200)"
  elif [ "$(cat "$TMP/indexnow.txt")" != "$KEY" ]; then
    fail "IndexNow key file content does not equal the key"
  else
    ok "IndexNow key file /$KEY.txt serves the key verbatim"
  fi
fi

# ── 8. Edge surface split: /v1/* stays edge, /healthz stays public ───────────
fetch "$TMP/v1.json" "$ORIGIN/v1/"
if [ "$(cat "$HTTP_CODE")" = "401" ] || [ "$(cat "$HTTP_CODE")" = "403" ]; then
  ok "/v1/ is edge-auth protected (HTTP $(cat "$HTTP_CODE"))"
else
  fail "/v1/ → HTTP $(cat "$HTTP_CODE") (expected 401/403 at the edge)"
fi
fetch "$TMP/healthz.txt" "$ORIGIN/healthz"
if [ "$(cat "$HTTP_CODE")" = "200" ]; then
  ok "/healthz is reachable"
else
  fail "/healthz → HTTP $(cat "$HTTP_CODE") (expected 200)"
fi

# ── 9. www 301 → apex (created by the same flag flip) ────────────────────────
WWW="$(echo "$ORIGIN" | sed -E 's#^https://#https://www.#')"
curl -fsSIL --max-time 20 "$WWW/" > "$TMP/www.txt" 2>/dev/null || true
WWW_CODE="$(head -1 "$TMP/www.txt" 2>/dev/null | awk '{print $2}')"
if [ "$WWW_CODE" = "301" ] && grep -qi "location: $ORIGIN/" "$TMP/www.txt"; then
  ok "www redirects 301 → $ORIGIN/"
else
  fail "www → HTTP ${WWW_CODE:-000} (expected 301 to the apex)"
fi

echo
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ] || exit 1
