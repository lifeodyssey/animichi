#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/local-login.sh"
MOCK_BIN="$(mktemp -d)"
CAPTURE="$(mktemp)"
trap 'rm -rf "$MOCK_BIN" "$CAPTURE"' EXIT

cat >"${MOCK_BIN}/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"/auth/v1/otp"* ]]; then
  exit 0
fi
printf '{}\n'
EOF

cat >"${MOCK_BIN}/python3" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'https://auth.example.test/auth/v1/verify?token=fixture&next=local\path'
EOF

cat >"${MOCK_BIN}/open" <<'EOF'
#!/usr/bin/env bash
printf '%s' "$1" >"${LOCAL_LOGIN_CAPTURE}"
EOF

cat >"${MOCK_BIN}/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "${MOCK_BIN}/curl" "${MOCK_BIN}/python3" "${MOCK_BIN}/open" "${MOCK_BIN}/sleep"

LOCAL_WEB_ORIGIN='https://local&host\dev' \
LOCAL_LOGIN_CAPTURE="${CAPTURE}" \
PATH="${MOCK_BIN}:${PATH}" \
  bash "${SCRIPT}" fixture@example.test >/dev/null

expected='https://local&host\dev/auth/v1/verify?token=fixture&next=local\path'
actual="$(<"${CAPTURE}")"
[[ "${actual}" == "${expected}" ]] || {
  printf 'expected rewritten URL %q, got %q\n' "${expected}" "${actual}" >&2
  exit 1
}
printf 'PASS local-login origin rewrite\n'
