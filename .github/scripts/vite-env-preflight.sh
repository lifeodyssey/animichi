#!/usr/bin/env bash
# Build-time shape preflight for VITE_* variables (B5, 2026-08-05).
#
# Why this exists: a 35-character Turnstile SECRET key was once stored in the
# VITE_TURNSTILE_SITE_KEY GitHub variable. Vite inlines every VITE_* value into
# the public client bundle at build time, so that secret shipped to a public
# site — and every existing guard was blind to it: gitleaks only sees git
# history (the value lived in GitHub's variable store, never in the repo), and
# the runtime check in apps/web/src/components/TurnstileGate.tsx:68 only fires
# in a browser, long after the value is baked into downloaded JS.
#
# This script runs BEFORE the build and validates SHAPES, not just presence:
#   - VITE_TURNSTILE_SITE_KEY must be exactly 24 characters (the site-key
#     length, per TurnstileGate.tsx). A 35-character value is the SECRET key
#     and gets a dedicated error; any other length is rejected fail-closed —
#     an unknown shape must never reach a build.
#   - Every other VITE_* value is checked by three predicates:
#       looks_like_turnstile_secret  — the 35-char [A-Za-z0-9_-] shape, which
#                                      this script only ever attributes to a
#                                      Turnstile secret (its message is that
#                                      specific); it is NOT a general secret
#                                      detector.
#       looks_like_private_key       — PEM/private-key markers, unambiguous.
#       looks_like_secret_material   — the UNIVERSAL rule: credential
#                                      prefixes or long base64/hex blobs in
#                                      ANY slot. Deliberately fail-closed;
#                                      false positives are escaped through
#                                      the explicit per-variable
#                                      secret_shape_allowlist() table, never
#                                      by silently loosening this predicate.
#   - VITE_NEON_AUTH_BASE_URL and VITE_SHOWCASE_MODE keep their presence/value
#     rules from the old inline preflight, moved here so they are testable.
#
# Rules live in the small table functions below (required / exact_length /
# allowed_values / secret_shape_allowlist) — one variable per case arm. The
# workflow step passes the names; values are read from the environment via
# indirect expansion. Values are NEVER echoed — only names and lengths go to
# the log.
set -euo pipefail

SITE_KEY_LENGTH=24
SECRET_KEY_LENGTH=35
# SECRET_MIN_LENGTH: shortest value the universal material check treats as
# credential-shaped. Below every realistic key shape (32-char hex, 40-char
# PATs) and above the 24-char site-key length, so the one known-legit
# key-shaped length never trips the generic rule by itself.
SECRET_MIN_LENGTH=28
SCRIPT_NAME="$(basename "$0")"

usage() {
  echo "usage: ${SCRIPT_NAME} VARNAME [VARNAME...]" >&2
  echo "  validates every listed VITE_* variable's shape; exit 1 on any violation" >&2
}

# ── variable → rule table ──────────────────────────────────────────────────
# Single source of truth for what shape each VITE_* variable must have.
# required(): "1" when an empty/unset value must refuse the build.
required() {
  case "$1" in
    VITE_TURNSTILE_SITE_KEY | VITE_NEON_AUTH_BASE_URL | VITE_SHOWCASE_MODE) echo 1 ;;
    *) echo 0 ;;
  esac
}

# exact_length(): the exact character count the value must have, or "" when
# the variable is shape-free (presence/value rules still apply).
exact_length() {
  case "$1" in
    VITE_TURNSTILE_SITE_KEY) echo "${SITE_KEY_LENGTH}" ;;
    *) echo "" ;;
  esac
}

# allowed_values(): a space-separated whitelist, or "" when unconstrained.
allowed_values() {
  case "$1" in
    VITE_SHOWCASE_MODE) echo "true false" ;;
    *) echo "" ;;
  esac
}

# secret_shape_allowlist(): space-separated lengths a variable may
# legitimately hold even when looks_like_secret_material() flags them, or ""
# when the variable has no exceptions. An entry here is visible policy — a
# statement that a specific VITE_* slot legitimately carries a long
# ID-shaped value — never a silent relaxation of the detector.
#
# VITE_CF_BEACON_TOKEN: Cloudflare Web Analytics beacon token, a 36-char
# UUID (hex + dashes) injected into the public <head> by analytics.ts. It is
# secret-shaped (36 chars of hex/`-`) but is a public site identifier, not a
# credential; the allowlist is the documented exception for it.
secret_shape_allowlist() {
  case "$1" in
    VITE_CF_BEACON_TOKEN) echo 36 ;;
    *) echo "" ;;
  esac
}

# allowed_secret_shape(): "1" when this variable explicitly allows the given
# length by secret_shape_allowlist(), "0" otherwise.
allowed_secret_shape() {
  local name="$1" length="$2" allowed
  allowed="$(secret_shape_allowlist "${name}")"
  [ -n "${allowed}" ] || {
    echo 0
    return
  }
  case " ${allowed} " in
    *" ${length} "*) echo 1 ;;
    *) echo 0 ;;
  esac
}

# ── shape predicates (each named for the property it detects) ───────────────

# looks_like_turnstile_secret(): 0 when the value has the exact shape of a
# Turnstile SECRET key — 35 chars of [A-Za-z0-9_-], the length-only contract
# from TurnstileGate.tsx (site keys 24, secrets 35). Turnstile-specific BY
# CONTRACT: it detects the Turnstile shape, nothing else — a 35-char value
# containing any other character is outside this predicate's scope and is
# the job of looks_like_secret_material().
looks_like_turnstile_secret() {
  [ "${#1}" -eq "${SECRET_KEY_LENGTH}" ] && [ -z "${1//[A-Za-z0-9_-]/}" ]
}

# looks_like_private_key(): 0 when the value carries PEM/private-key markers.
# Unambiguous — no legitimate VITE_* value contains these — so no allowlist
# can exempt it (see check_secret_shape).
looks_like_private_key() {
  case "$1" in
    -----BEGIN*) return 0 ;;
  esac
  case "$1" in
    *"PRIVATE KEY"*) return 0 ;;
  esac
  return 1
}

# looks_like_secret_material(): the universal rule — 0 when the value could
# be a credential in ANY VITE_* slot, regardless of which service it belongs
# to. Either signal alone is enough:
#   • a known credential prefix (sk-/pk_/ghp_/AKIA/xoxb-/eyJ/…); or
#   • SECRET_MIN_LENGTH+ chars of only base64/base64url/hex characters —
#     high-entropy material with no URL structure (any value containing ':'
#     or '.' is NOT composed of that alphabet, so URLs and hostnames never
#     match here).
# Fail-closed on purpose: a suspicious shape refuses the build until a human
# adds an explicit secret_shape_allowlist() entry — never by loosening this
# predicate.
#
# The composition check uses [[ =~ ]] regex (not the ${var//pat/} idiom used
# elsewhere in this script) because a literal '/' inside a ${var//…/}
# pattern terminates the pattern early in bash's parser — the class would
# silently match nothing and the whole predicate would dead-open. Regex
# bracket classes have no such limitation.
looks_like_secret_material() {
  local value="$1"
  case "${value}" in
    sk-* | sk_* | pk_* | ghp_* | gho_* | ghu_* | AKIA* | xoxb-* | xoxp-* | AIza* | eyJ* | SG.*) return 0 ;;
  esac
  [ "${#value}" -ge "${SECRET_MIN_LENGTH}" ] || return 1
  [[ "${value}" =~ ^[-A-Za-z0-9_+=/]+$ ]]
}

# ── per-variable checks ─────────────────────────────────────────────────────

# check_secret_shape(): universal rule — a secret-shaped value in ANY VITE_*
# slot means a secret is about to be inlined into the public client bundle.
# The site-key slot is skipped here: check_exact_length rejects a 35-char
# value in that slot with a more specific message. Allowlist scoping is
# minimal: looks_like_turnstile_secret and looks_like_private_key are
# unconditional (their shapes are never legitimate in a client bundle), while
# the generic looks_like_secret_material rule yields to an explicit
# secret_shape_allowlist() entry.
check_secret_shape() {
  local name="$1" value="${!1-}" length
  [ -n "${value}" ] || return 0
  [ "${name}" != "VITE_TURNSTILE_SITE_KEY" ] || return 0
  length="${#value}"
  if looks_like_turnstile_secret "${value}"; then
    echo "::error::${name} is ${length} characters and matches the Turnstile SECRET-key shape. A VITE_* variable is inlined into the public client bundle by Vite at build time; a secret in this slot would be shipped to every visitor. Refusing to build."
    FAILED=1
    return 0
  fi
  if looks_like_private_key "${value}"; then
    echo "::error::${name} looks like a private key (PEM/PRIVATE KEY marker). VITE_* values are inlined into the public client bundle by Vite at build time; private keys belong in GitHub Secrets, never in a VITE_* variable. Refusing to build."
    FAILED=1
    return 0
  fi
  if ! looks_like_secret_material "${value}"; then
    return 0
  fi
  if [ "$(allowed_secret_shape "${name}" "${length}")" = "1" ]; then
    echo "::warning::${name} is ${length} characters and looks like secret material, but that length is explicitly allowlisted for this variable (secret_shape_allowlist in ${SCRIPT_NAME}). Re-verify the entry is still needed."
    return 0
  fi
  echo "::error::${name} is ${length} characters of base64/hex-shaped material or carries a known credential prefix — it looks like a secret, and a VITE_* variable is inlined into the public client bundle by Vite at build time. Secrets belong in GitHub Secrets, never in a VITE_* slot. Refusing to build (fail-closed: add an explicit secret_shape_allowlist entry if this is a false positive)."
  FAILED=1
}

# check_required_presence(): refuses the build when a required variable is
# empty/unset — an empty value ships a permanently broken feature with no
# runtime remedy.
check_required_presence() {
  local name="$1" value="${!1-}"
  [ "$(required "${name}")" = "1" ] || return 0
  [ -z "${value}" ] || return 0
  echo "::error::${name} is empty/unset (component=${TARGET_COMPONENT-}, environment=${TARGET_ENVIRONMENT-}). Refusing to build: an empty value ships a permanently broken feature with no runtime remedy."
  FAILED=1
}

# check_exact_length(): enforces the exact_length() table. The site-key slot
# names the SECRET specifically when the value is 35 characters; any other
# mismatch is fail-closed — an unknown shape must never reach a build.
check_exact_length() {
  local name="$1" value="${!1-}" length expected
  [ -n "${value}" ] || return 0
  length="${#value}"
  expected="$(exact_length "${name}")"
  [ -n "${expected}" ] || return 0
  if [ "${name}" = "VITE_TURNSTILE_SITE_KEY" ]; then
    if [ "${length}" -eq "${SECRET_KEY_LENGTH}" ]; then
      echo "::error::VITE_TURNSTILE_SITE_KEY is ${length} characters — that is the Turnstile SECRET key, not the site key. Site keys are exactly ${SITE_KEY_LENGTH} characters. A VITE_* value is inlined into the public client bundle at build time; refusing to build a secret into the client. Re-set the GitHub variable to the ${SITE_KEY_LENGTH}-character site key."
      FAILED=1
    elif [ "${length}" -ne "${expected}" ]; then
      echo "::error::VITE_TURNSTILE_SITE_KEY must be exactly ${expected} characters (got ${length}). Unknown shape — refusing to build (fail-closed: only the ${expected}-character site key is accepted)."
      FAILED=1
    fi
    return 0
  fi
  if [ "${length}" -ne "${expected}" ]; then
    echo "::error::${name} must be exactly ${expected} characters (got ${length})."
    FAILED=1
  fi
}

# check_allowed_values(): enforces the allowed_values() whitelist; an empty
# value is already handled by check_required_presence, not this rule.
check_allowed_values() {
  local name="$1" value="${!1-}" allowed
  [ -n "${value}" ] || return 0
  allowed="$(allowed_values "${name}")"
  [ -n "${allowed}" ] || return 0
  case " ${allowed} " in
    *" ${value} "*) return 0 ;;
  esac
  echo "::error::${name} must be one of: ${allowed} (got a ${#value}-character value). Refusing to build: the client config module throws at module init on any other value."
  FAILED=1
}

# check_value(): runs every rule against one variable; sets FAILED=1 on any
# violation. Prints one ::error:: line per violation (names and lengths only,
# never values).
check_value() {
  local name="$1"
  check_secret_shape "${name}"
  check_required_presence "${name}"
  check_exact_length "${name}"
  check_allowed_values "${name}"
}

main() {
  [ "$#" -gt 0 ] || {
    usage
    exit 1
  }
  local name
  FAILED=0
  for name in "$@"; do
    check_value "${name}"
  done
  if [ "${FAILED}" -eq 1 ]; then
    exit 1
  fi
  echo "${SCRIPT_NAME}: checked $# VITE_* variable(s) — all shapes valid"
}

main "$@"
