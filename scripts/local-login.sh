#!/usr/bin/env bash
set -euo pipefail

# Local Login — triggers a real magic link via local Supabase,
# fetches it from Mailpit, and opens it in your browser.
# Walks the same auth path as a real user.
#
# Prerequisites:
#   - supabase start (with Mailpit)
#   - supabase functions serve send-auth-email --no-verify-jwt
#   - web app running on localhost:3000
#
# Usage: make local-login
#        bash scripts/local-login.sh [email]

EMAIL="${1:-dev@seichijunrei.test}"
SUPABASE_URL="http://127.0.0.1:54321"
ANON_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
MAILPIT_URL="http://localhost:54324"
LOCAL_WEB_ORIGIN="${LOCAL_WEB_ORIGIN:-http://localhost:3000}"

echo "Sending magic link to: $EMAIL"

# Trigger OTP (this goes through the real auth flow including Edge Function)
curl -s -X POST "$SUPABASE_URL/auth/v1/otp" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}" > /dev/null

# Wait for email in Mailpit
echo "Waiting for email in Mailpit..."
for i in $(seq 1 20); do
  LINK=$(curl -s "$MAILPIT_URL/api/v1/messages" | python3 -c "
import sys, json, urllib.request, re
d = json.load(sys.stdin)
for m in d['messages']:
    if any(t['Address'] == '$EMAIL' for t in m['To']):
        resp = urllib.request.urlopen(f'$MAILPIT_URL/api/v1/message/{m[\"ID\"]}')
        detail = json.loads(resp.read())
        links = re.findall(r'href=\"([^\"]+)\"', detail['HTML'])
        for l in links:
            l = l.replace('&amp;', '&')
            if '/auth/' in l:
                print(l)
                break
        break
" 2>/dev/null)

  if [ -n "$LINK" ]; then
    # Rewrite the callback origin to the local web app.
    LINK_PATH="/${LINK#*://*/}"
    LOCAL_LINK="${LOCAL_WEB_ORIGIN%/}${LINK_PATH}"
    echo ""
    echo "✅ Magic link found!"
    echo ""
    echo "Opening in browser..."
    open "$LOCAL_LINK" 2>/dev/null || echo "Open this URL: $LOCAL_LINK"
    exit 0
  fi
  sleep 1
done

echo "❌ No email received within 20s. Check:"
echo "   - supabase functions serve running?"
echo "   - Mailpit at $MAILPIT_URL"
exit 1
