# Anitabi egress service

How the catalog reaches `api.anitabi.cn` from an address the upstream can allowlist, and how to
operate that service. Companion to [`deployment.md`](./deployment.md) (which covers everything
that *does* go through CD) and [`secrets.md`](./secrets.md).

**No address and no secret value appears in this file.** The egress address is the thing an
upstream allowlists; this repository is public, so publishing it would announce which address
holds that privilege. Read the live value from Fly (below) when you need it.

## Why this exists

Cloudflare Workers egress from a shared IP pool whose reputation we do not control. The upstream
began refusing us with a Cloudflare challenge page (HTTP 403) — not because of the endpoints we
call, which are both documented, and not because we touched their main domain, which product code
never does. The upstream operator offered to allowlist a specific address instead.

Cloudflare's own dedicated egress IP is Enterprise-only. A survey of the alternatives found the
cheap hosted proxies use *shared* addresses on their entry tiers, which would return us to the
same problem. So: one small service on Fly with a static egress address, doing nothing else.

Tracked in #1792. The licence-compliance half — attribution and image sizing — is #1791.

## Deployment is deliberately manual

This service does **not** go through CD. That is an owner-granted exemption to the repository's
`block-local-deploy` rule, given on 2026-09-18, not an oversight. Everything else still goes
through CD.

## What it is

One Fly app, `animichi-anitabi-egress`, in Tokyo (`nrt`). Its own app, because
`fly ips allocate-egress` allocates per app: **the app boundary is the allowlisted-address
boundary**, and nothing else may share that identity.

It exposes named operations only:

```
GET /anitabi/points/{bangumiId}
GET /anitabi/lite/{bangumiId}
```

The service builds the upstream URL itself. There is no "target" parameter anywhere in it. This
is the control that survives a leaked credential: with the key in hand, the worst an attacker can
do is ask for public landmark data. No code path can express another host.

A forwarder taking a URL plus an allowlist would **not** be equivalent. An allowlist is
configuration and drifts; an API surface is code and goes through review.

## Authentication

The caller signs, it does not send a token. An HMAC over the timestamp and request path, with the
signature and timestamp in headers — the key itself never crosses the wire, a captured request
cannot be replayed past a short window, and no credential can land in a log.

Caller IP allowlisting is impossible here, and the reason is the whole point of this service:
Workers have no stable egress address.

The service accepts a current and a previous key, so rotation needs no coordinated cut-over: add
the new key, switch the caller, drop the old one. **Do not schedule rotation.** With the narrow
API, a leaked key buys public data until the rate ceiling refuses; a calendar ritual would cost
more than it protects. The two-key window exists so rotation is painless when there is a reason.

## Rate ceiling

**100 upstream requests per hour**, enforced by the service regardless of what the caller asks.

This is a promise to the upstream, not a tuning knob. Changing it means changing an agreement.

It also defends against us: #1784 found a refused job being re-queued hourly for six hours. The
ceiling is what stops a caller-side bug from spending the relationship.

The ceiling counts **requests**; `workers/catalog/src/cron-config.ts`'s caps count **works**, and
one work can cost more than one request. A contract test converts between them so raising a work
cap cannot silently exceed the ceiling.

## Three ways a fetch fails, and they are not interchangeable

| refused by | meaning | what to do |
|---|---|---|
| upstream | they said no (401/403) | talk to them |
| upstream | they failed (5xx/408/429) | wait; it retries |
| **this service** | rate ceiling, or auth | **raise the ceiling or fix the caller — do not contact the upstream** |

The third is the one that misleads: if our own ceiling looked like an upstream refusal, we would
believe we had been blocked again and spend the relationship asking about it. The service marks
its own refusals distinguishably, and `workers/catalog` maps the three onto distinct failure
codes. Their retry behaviour differs too — the ceiling clears within the hour, a 403 does not.

## Operating it

Every command needs `fly auth login` first. Read-only commands are safe to run any time.

```bash
# Which address the upstream allowlisted. Read it here; it is not in the repo.
fly ips list --app animichi-anitabi-egress

# Health and recent activity
fly status --app animichi-anitabi-egress
fly logs   --app animichi-anitabi-egress

# Deploy (manual, per the exemption above)
fly deploy --app animichi-anitabi-egress

# Rotate the signing key. Generate locally; never paste a value into a PR,
# an issue, or a chat. `--stage` defers the machine restart until deploy.
fly secrets set INGEST_SIGNING_KEY="$(openssl rand -base64 48)" \
  --app animichi-anitabi-egress --stage
fly secrets deploy --app animichi-anitabi-egress
```

The same key must be set in Cloudflare Secrets Store for `workers/catalog`.

## If ingest starts failing

Work in this order; the first two are free and rule out most of it.

1. **Which refusal is it?** Read the failure code on the `ingest_jobs` row. Our own ceiling and an
   upstream 403 are different problems with different fixes — see the table above.
2. **Has the address changed?** `fly ips list` against the value the guard pins. An egress address
   is allocated once and persists across deploys, so a change here is unexpected and would mean
   the allowlist silently stopped matching. **This is the failure that is quiet**: nothing breaks
   loudly, ingest simply stops succeeding.
3. **Is the service up?** `fly status`, then `fly logs`.
4. **Did the upstream change its terms?** Their API document is the source of truth for which
   endpoints and image sizes are allowed; it also forbids requesting the main domain in any
   scenario.

## What this service must never have

No Neon credential. No user data. No write path. No parameter naming a destination. If a proposed
change would let an attacker who had read the entire (public) repository do more than request
public landmark data until the ceiling refuses them, that change is wrong.
