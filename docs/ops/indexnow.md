# IndexNow Key

## What it is

IndexNow is the instant URL-submission protocol for the Bing/Naver family
(Google's sitemap-ping endpoint is deprecated). A site proves ownership of
its URLs by publishing a key file at `https://<host>/<key>.txt` whose content
is the key itself, then pinging the IndexNow endpoint with the key + URLs.

The key is **public by design** — search engines must be able to fetch it —
so it lives in `apps/web/public/`, committed like any other static asset, not
in a secret store.

## Where it lives

- `apps/web/public/<key>.txt` — the verification file, served verbatim from
  the `public/` directory.
- `apps/web/src/features/seo/indexnow.ts` — the `INDEXNOW_KEY` constant.
  `tests/unit/seo/static-files.test.ts` asserts the file exists, its content
  equals the key, and the key is 32 lowercase hex chars — the file and the
  ping signature cannot drift apart.
- The key is not yet consumed by a push script: iteration 0 only reserves it
  (iter-0 spec), and the new-season SLA push (`scripts/indexnow-push.ts`)
  arrives with the anime sitemap in iteration 5.

Current key: `ab12ab12ab12ab12ab12ab12ab12ab12` (deliberately low-entropy —
the key's only power is pushing URLs on hosts that serve this file, so
entropy is not a security property; low entropy also keeps secret-scanners
quiet on a committed constant).

## Regenerating (only when actually needed)

Rotating changes the file name **and** the constant **and** invalidates any
in-flight ping using the old key, so it is not routine.

1. Generate a fresh 32-hex key: `openssl rand -hex 16`
2. Replace the value in `apps/web/src/features/seo/indexnow.ts`.
3. Replace the file: rename `apps/web/public/<old-key>.txt` to
   `apps/web/public/<new-key>.txt` with the new key as content.
4. Update this document.
5. Run `pnpm --filter web test` — the static-files suite re-pins file name ==
   key and content == key.
6. Ship via the normal deploy path (the file is copied verbatim from
   `public/`; no build step or environment variable references the key).
