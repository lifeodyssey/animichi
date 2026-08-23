# Chat entry delivery brief — 2026-08-24

## Accepted behavior

- Desktop `/` dismisses the splash into the doorway and enters `/chat` only
  after the visitor activates the CTA.
- Mobile `/` keeps the fast, history-replacing hand-off to `/chat`.
- An authenticated visitor mounts Chat immediately.
- An anonymous visitor sees a full-viewport Turnstile gate. Chat does not mount
  until the edge has verified the token and returned success.
- The edge issues an aid-bound, signed, short-lived pass after verification so
  the first chat request works across Worker isolates without reusing the
  single-use Turnstile token.
- Verification rejection, missing configuration, timeout, and network failure
  fail closed and remain retryable. A successful admission keeps the current
  Chat mounted and a `?q=` query is sent at most once.

## Evidence required for merge

- Edge tests cover two-isolate admission, wrong aid, expiry, malformed proof,
  and signature tampering.
- Web tests cover authenticated bypass, pre-mount blocking, retry, and one-time
  query send.
- Browser tests cover desktop CTA, mobile hand-off, gate challenge/verifying/
  failure axe scans, and keyboard retry.
- Independent review has no unresolved blocking, P1, or P2 finding.

## Deferred work

- Shiori is not part of this Stage 1 delivery; it remains a later product card.
- Production smoke is manual for this release. Automated external smoke remains
  explicit tech debt because GitHub-hosted Actions are challenged by Cloudflare.
