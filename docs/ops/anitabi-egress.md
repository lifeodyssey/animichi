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
do is ask for public landmark data. No code path can express another host — and the connection set
is that one URL, since a `Location` header on the upstream's answer is refused rather than followed
(`redirect: "error"`, #1806).

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

The window is the **fixed UTC clock hour**: a request counts against the hour the clock puts it in,
and the hour ends when the clock says so. That is the reading of "per hour" the agreement records,
and it is what lets the count live outside the service — two machines derive the same hour with no
coordination, where an hour measured from the first request, or from a process's start, is a window
only one process can know. Like any fixed window it admits a burst across a boundary: up to the
ceiling at the end of one hour, and up to it again at the start of the next.

**The count lives in an external store, not in the process** (#1810). A deploy, a secret rotation or
a crash used to start a fresh hour, so the service could relay a second hour's worth inside the
upstream's original one while this file stated the ceiling as enforced. The count now survives all
three, and a second instance spends from the same budget as the first.

The store is the Redis that `fly redis create` provisions — one small instance in the app's own
primary region, holding **one integer per clock hour**. It is reached over TCP with RESP at
`CEILING_STORE_URL`, which is the store's **Private URL** and nothing else: a `redis` address with
the store's own password inside it, set as one `fly secrets` value on this app. It is required at
boot — without a store it can dial, the service has no ceiling to enforce and refuses every request
with `configuration` rather than running uncounted.

**Why not Upstash REST.** #1810 first chose an HTTPS `/pipeline` endpoint addressed by a second
secret. Fly's Redis extension is not that product: it hands out one TCP Private URL, `fly redis
status` prints nothing an HTTPS adapter could be filled from, and a `CEILING_STORE_URL` left over
from that shape fails closed at boot rather than being dialed as if it were Redis (#1824).

**When the store is down, the service refuses.** It does not fall back to counting in memory — an
unreachable store must not silently restore the behaviour this replaced. The refusal is the ceiling's
own, marked as ours so the caller never reads it as an upstream answer, and its body names the cause
the reason header cannot:

```json
{"refusedBy":"anitabi-egress","reason":"ceiling","detail":"ceiling-store-unavailable"}
```

`x-egress-refusal` still says `ceiling` on purpose. That header is a vocabulary the caller classifies
by — `workers/catalog` knows six reasons and reads an unknown one as `unmarked`, "this answer did not
come from the egress service", which would be false. Whose refusal it is travels in the header; which
of the two ceiling refusals it was is in the body.

**Why not the data plane.** The constraint this service exists under is *"No Neon credential. No user
data. No write path."* and it still holds. The store is not Neon and holds no product data: it is a
counter, reachable with its own credential, holding one integer per hour under a key derived from the
clock. Its token opens that counter and nothing else, so a compromised egress service can spend the
ceiling — a denial of service it already has by construction — and cannot read or write a row of user
data. A Neon credential here would change that sentence and the blast radius with it, which is why
the counter is a store and the data plane is not.

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
| **this service** | rate ceiling — or the counter behind it — or auth | **raise the ceiling, fix the caller, or fix the store — do not contact the upstream** |

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

# The ceiling's counter. ONE INTEGER PER CLOCK HOUR lives behind this one
# value, and the service refuses every request without a store it can dial.
# `fly redis create` provisions the store; its `status` prints the Private URL,
# which is the whole configuration. Never paste that URL into this repository,
# an issue, or a chat — the password is inside it.
fly redis create --primary-region nrt --name animichi-anitabi-egress-ceiling
fly redis status animichi-anitabi-egress-ceiling   # prints the Private URL

fly secrets set CEILING_STORE_URL="redis://<user>:<password>@<host>:<port>" \
  --app animichi-anitabi-egress --stage
fly secrets deploy --app animichi-anitabi-egress

# Rotate the signing key. Generate locally; never paste a value into a PR,
# an issue, or a chat. Fly never shows a secret's value, so `<the current key>`
# is the one you generated and kept. `--stage` holds the change and the one
# `fly secrets deploy` below is the only restart: BOTH values go in ONE
# release, so the release that installs the new key still accepts the old.
# This is ordering (1); ordering (2) is the caller, and it comes after.
# See "Rotation has two orderings" below.
fly secrets set INGEST_SIGNING_KEY="$(openssl rand -base64 48)" \
  INGEST_SIGNING_KEY_PREVIOUS="<the current key>" \
  --app animichi-anitabi-egress --stage
fly secrets deploy --app animichi-anitabi-egress
```

The store's password is the provider's value, not one this repository generates, so it is not held to
the signing key's 64-character shape: a value the store will not open is refused by the store
(`NOAUTH`/`WRONGPASS`), which the ceiling turns into the same refusal an unreachable store produces.
Rotate it the way you set it, alone in one release — nothing else holds it, so there is no ordering to
keep, and a fresh store simply starts a fresh hour's count.

**The live store is operator-provisioned, and this change provisions none.** No store is created by
the repository: the values are the operator's, set on the Fly app as above, in the same category as
the signing key's Fly copy — the one input here that Pulumi does not manage (the ESC/Secrets Store
chain in #1812 provisions the *caller's* copy of the signing key, and stops at the Worker).

**Provisioning it, after this card merges** (#1824): `fly redis create` with primary region `nrt`,
then `fly secrets set CEILING_STORE_URL="<the Private URL from fly redis status>" --app
animichi-anitabi-egress`. Two steps, and the second is the only one that touches the app. Until it
runs, the service has no store and refuses every request with `configuration` — loudly, which is what
that refusal is for.

### Rotation has two orderings

They are not two wordings of one rule. They order two different things — the two keys inside the Fly
app, and the Fly app against the caller's copy — so both apply, and a reader who collapses them
keeps only one and ends up with callers refused. Follow them in this sequence.

1. **Within Fly: both keys go in ONE release.** The command above sets the new
   `INGEST_SIGNING_KEY` and the old value as `INGEST_SIGNING_KEY_PREVIOUS` together, and its single
   `fly secrets deploy` is the only restart, so the release that installs the new key still accepts
   the old one. Set them in two releases and the restart between them drops the old key while
   callers are still signing with it.
2. **Across systems: Fly goes first.** `workers/catalog` binds `INGEST_SIGNING_KEY` from the
   Cloudflare Secrets Store, written by the `infra/database-access` stack from owner-set ESC
   config. Put **the same value** you generated above there only once the release is live: until
   the ESC edit and the apply catch up, the caller is still signing with the old key, which this
   release accepts as its previous key. Reverse it and the caller signs with a key the service has
   not been told about, which is refused. See [`secrets.md`](./secrets.md).
3. **Then drop the previous key**, in a later release, once the caller is confirmed on the new one.

That store entry is never set by hand. A Secrets Store secret name is unique within its store and
create does not adopt one, so a hand-made `INGEST_SIGNING_KEY` there would be a second authority
for a value the service already holds — and the stack's create would fail rather than adopt it.
The caller's copy is `pulumiConfig.animichi-neon-secrets:INGEST_SIGNING_KEY` in
`lifeodyssey/animichi/staging` or `…/prod` (`fn::secret`), applied by Pulumi, never by CI.

## If ingest starts failing

Work in this order; the first two are free and rule out most of it.

1. **Which refusal is it?** Read the failure code on the `ingest_jobs` row. Our own ceiling and an
   upstream 403 are different problems with different fixes — see the table above.
2. **Which ceiling refusal is it?** A `ceiling` refusal the service marked carries a body, and
   `detail: ceiling-store-unavailable` means the hour's count could not be read: a store problem, not
   traffic. If the budget itself ran out, the caller is spending more than the agreement allows. If it
   did not, `fly secrets list --app animichi-anitabi-egress` first — the service refuses everything
   with `configuration` when the store's address is missing, unreadable, or not a `redis` address, so
   a secret that was never set (or a leftover `https://` one from #1810) and a store that is down look
   different from outside.
3. **Has the address changed?** `fly ips list` against the value the guard pins. An egress address
   is allocated once and persists across deploys, so a change here is unexpected and would mean
   the allowlist silently stopped matching. **This is the failure that is quiet**: nothing breaks
   loudly, ingest simply stops succeeding.
4. **Is the service up?** `fly status`, then `fly logs`.
5. **Did the upstream change its terms?** Their API document is the source of truth for which
   endpoints and image sizes are allowed; it also forbids requesting the main domain in any
   scenario.

## What this service must never have

No Neon credential. No user data. No write path. No parameter naming a destination. If a proposed
change would let an attacker who had read the entire (public) repository do more than request
public landmark data until the ceiling refuses them, that change is wrong.

The ceiling's counter (#1810) is the one thing this service writes, and it is not an exception to
that list so much as an instance of it: one integer per clock hour, under a key derived from the
clock and from nothing else, in a store no product code reads and whose credential opens nothing
but that key. It holds no user data, names no destination the service could be asked for, and is
never the data plane — see "Why not the data plane" above.
