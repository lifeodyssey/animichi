# anitabi-egress

The fixed-address egress service the catalog fetches anitabi through (#1792).
One Fly app, `animichi-anitabi-egress`, in Tokyo; TypeScript on Node, no
runtime dependencies, no product data, no data-plane credential, and no write
path beyond the ceiling's own counter (#1810).

The operations, the checks and the hostname are all public — the repository is
public and the design never depended on hiding them. The only things that stay
out of this tree are the signing key, the ceiling store's Private URL (which
carries its own password), all Fly secrets, and the egress address (the upstream
allowlists it; see the guard below).

## What it serves — and all it can serve

```
GET /anitabi/points/{bangumiId}   → https://api.anitabi.cn/bangumi/{id}/points/detail?haveImage=true
GET /anitabi/lite/{bangumiId}     → https://api.anitabi.cn/bangumi/{id}/lite
```

There is no third operation and no way to express one: the upstream URL is
built inside `src/upstream-operations.ts` from the parsed route alone. No
parameter, header, or path segment names a destination — this is the control
that survives a leaked key. The connection set is the same one URL: a
`Location` header on the upstream's answer is refused rather than followed
(`redirect: "error"`), because global `fetch` follows redirects by default and
that is a second destination this repository never reviewed (#1806).

## Authentication: signed requests, never a token

The caller sends `x-egress-timestamp` (unix seconds) and `x-egress-signature`
(lowercase-hex HMAC-SHA256 over `${timestamp}\n${path}`). The key never
crosses the wire; signatures outside a five-minute window are refused;
comparison is constant-time. The service accepts a current and a previous key
(`INGEST_SIGNING_KEY`, `INGEST_SIGNING_KEY_PREVIOUS`) so rotation needs no
coordinated cut-over.

Every configured key — the service's current and previous, and the catalog's
one — must match `/^[A-Za-z0-9+/]{64}$/`, the shape `openssl rand -base64 48`
writes: 64 unpadded standard-Base64 characters. Generate keys with that
command; it is a requirement on the operator, not a check the service makes.
That shape is the whole check, and it is all a check on a string can be —
nothing readable from one measures a key's randomness or says which generator
produced it, so 64 characters of `a` passes it and must never be used as a
key. A value outside the shape fails both sides closed: the service boots
without a usable configuration and refuses both operations with
`configuration`, and the catalog resolves no key, so an anitabi fetch refuses
rather than sign with a value the service will not accept. A previous key
outside the shape reads as absent, not as an accepted one.

Do not schedule rotation — the two-key window exists so rotation is painless
when there is a reason.

## The ceiling

`UPSTREAM_REQUEST_CEILING_PER_HOUR` (fly.toml `[env]`, the one place in the
repository that states the number) caps upstream requests per hour. It is a
promise to the upstream, not a tuning knob: changing it means changing the
agreement. The service refuses past it with a response marked as its own, so
the caller never mistakes our ceiling for an upstream refusal.

The window is the **fixed UTC clock hour**, and the count lives in an external
counter — the Redis `fly redis create` provisions, holding one integer per hour
and reached over TCP with RESP at `CEILING_STORE_URL` (#1810, #1824). That value
is the store's **Private URL**: a `redis` address with the store's own password
inside it, set with `fly secrets` and required at boot. Counting outside the
process is what makes the promise survive a deploy, a rotation or a crash, and
what makes two instances share one budget; counting in a fixed clock hour is
what lets both derive its key from the clock alone. As with any fixed window, a
request burst can straddle a boundary.

**Fail closed.** A store the service cannot reach means the service cannot
count, and it refuses every request (`ceiling`, with
`detail: ceiling-store-unavailable` in the body) rather than falling back to a
count in memory. A `CEILING_STORE_URL` that is missing, that still carries the
`https://` REST endpoint #1810 used, or that is not a `redis` address at all, is
refused at boot the same way, as `configuration`. A ceiling that is not enforced
is not a ceiling.

The body says which of the two ceiling refusals it was; *why* the store could
not be read goes to the service's own log stream instead — one JSON line per
failed increment, carrying the store's own message and a `code` naming which
reply-set guard fired or how the connection ended. `fly logs` reads it, and
[`docs/ops/anitabi-egress.md`](../../docs/ops/anitabi-egress.md) lists the
codes. The line carries no address and no credential.

## Reading the answers

Every response carries `x-egress-response`:

- `relayed-upstream` — status and body are the upstream's, verbatim
  (`content-type` and `retry-after` forwarded).
- `refused-here` — this service refused; `x-egress-refusal` says why:
  `auth`, `ceiling`, `no-such-operation`, `method-not-allowed`,
  `configuration`, or `upstream-timeout`. That vocabulary is the caller's
  (`workers/catalog` classifies by it and knows no other), so a `ceiling`
  refusal caused by an unreachable store says so in the body's `detail`
  rather than in a seventh reason.

## The address guard

The asset is the allowlisted address; the quiet failure is it changing. The
expected address is **not in this public tree** (a committed hash proves
nothing — IPv4 brute-forces in seconds); it reaches the guard through the
`ANITABI_EGRESS_EXPECTED_IPV4` environment variable, held in the operator's
shell or a CI secret:

```bash
ANITABI_EGRESS_EXPECTED_IPV4=<address> pnpm run guard:egress-address
```

Read-only (`fly ips list`); exit 1 on any mismatch or unavailability, naming
no address in its output.

## Deploy (manual, by owner-granted exemption)

```bash
fly deploy . --config apps/anitabi-egress/fly.toml \
  --dockerfile apps/anitabi-egress/Dockerfile --app animichi-anitabi-egress
```

The app needs three secrets, all set with `fly secrets` and none of them in this
tree: `INGEST_SIGNING_KEY` and its rotation mate `INGEST_SIGNING_KEY_PREVIOUS`,
and `CEILING_STORE_URL`, the Private URL of the store the ceiling counts in. Set
the two signing keys in ONE release —
`fly secrets set INGEST_SIGNING_KEY=<new> INGEST_SIGNING_KEY_PREVIOUS=<old>`,
where `<old>` is the value now current (Fly never shows a secret it already
holds, so it is the one you generated and kept). One release means one restart,
with the old key accepted from the first request after it; set them in two
releases and the restart between them drops the old key first. Update the
caller, then remove the previous key after the overlap window.

`CEILING_STORE_URL` has no ordering to keep: it is the only value holding the
counter, so rotating it is setting it. A store the service cannot open refuses
every request until it can. No store is provisioned from this repository — it is
entirely the operator's, like the signing key's Fly copy: `fly redis create`
(primary region `nrt`), then `fly redis status` for the Private URL, then
`fly secrets set CEILING_STORE_URL=<that URL> --app animichi-anitabi-egress`.
Never paste that URL anywhere but `fly secrets`: the password is inside it.
