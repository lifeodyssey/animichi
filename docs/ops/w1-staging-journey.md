# W1 staging journey — the manual verification the rewrite is judged by

Spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §五 gives W1 one exit
criterion, and it is deliberately a human one: **staging 匿名可完整对话；切走再回来
拉到完整结果（手动验证，无自动 eval）**. §六's `(browser)` acceptance criterion is the
same journey — "回合中切走 → 回来 GET 拿到完整结果（owner 的核心场景）".

This is that journey, written to be run by one person in one sitting. It is the
`(browser)` evidence for W1-5 (#1254), deferred there because nothing routed to
the new tier until W1-7 (#1256) flipped `AGENT_TURN_ROUTE`.

The signed-in half is automated instead — `workers/edge/api-test/agent-turn.test.ts`
(`pnpm --filter edge-worker run test:catalog-api`). The anonymous half cannot be:
its door is behind Turnstile, which is a challenge only a real browser solves.

## 0 · Preconditions (check these, do not assume them)

1. The deploy under test carries the flag. `workers/edge/wrangler.toml`
   `[env.staging.vars]` must read `AGENT_TURN_ROUTE = "edge"`, and that commit
   must be the one CD deployed — merged is not deployed (`docs/ops/deployment.md`).
2. `https://staging.animichi.com/healthz` answers 200.
3. Staging binds `AGENT_SVC_DATABASE_URL` (it does; production deliberately does
   not until #855). Without it every turn 500s on `AGENT_SVC_DATABASE_URL is not bound`.

Screenshot **S0**: the deployed commit sha next to the `healthz` body.

## 1 · Anonymous full conversation

1. Open `https://staging.animichi.com/` in a **fresh private window** — a new
   window is what makes the visitor anonymous rather than whoever logged in last.
2. Open DevTools → Network, and keep it open for the whole journey. Filter on
   `chat`.
3. Solve the Turnstile challenge if the widget shows one, then send a first
   message with an obvious next move, e.g. `らき☆すたの聖地巡礼をしたい`.
4. In Network, open the `POST /v1/chat` row.

Check, on that row:

- Status `200`, response header `x-vercel-ai-ui-message-stream: v1` — the turn is
  being streamed live by the edge tier.
- Response header `x-session-id` — **write this value down**, it is the
  conversation id every later step needs. (A `202` with a JSON body instead means
  the live view could not be opened; the run is still committed and the rest of
  the journey still works — note it and continue.)
- In the streamed frames: `tool-input-start` with `"toolName":"resolve_anime"`,
  then a `tool-output-available` carrying the same `toolCallId`, then TWO
  `data-response` parts under the same `"id":"response"` — the first carrying
  only `{"intent":…}`, the second the whole answer — then `finish`.
- On the page itself: the answer RENDERS. The card the second part draws is
  chosen by its `intent` (`apps/web/src/features/chat/registry.ts`), so a
  `resolve_anime` → `search_bangumi` turn shows a results card and a greeting
  shows prose.

Screenshot **S1**: the Network row's response headers (`x-session-id` visible).
Screenshot **S2**: the frame list showing the `resolve_anime` input/output pair,
both `data-response` parts and the closing `finish`.
Screenshot **S2b**: the rendered answer card in the page.

> **What to check, not just that text appeared:** the `respond` tool the model
> ends its turn with is deliberately NOT shown as a tool part (#1283,
> `workers/edge/src/agent/session/turn-frames.ts`) — an answer is an answer, not
> a tool call the user watches. A `tool-input-start` with
> `"toolName":"respond"` in the frame list is a regression, not progress.

5. Send a **second** message in the same window ("秩父にも行きたい") and confirm the
   `POST /v1/chat` carries the same `x-session-id` back. One conversation, two
   turns — this is the "完整对话" half.

Screenshot **S3**: the second turn's frames.

## 2 · Leave mid-turn

1. Send a third message.
2. **While the frames are still arriving**, navigate away — switch the tab to
   another site, or close the tab outright. Do not just minimize the window.
3. Wait 60 seconds. The turn's whole budget is 100s
   (`TURN_DEADLINE_MS`, `workers/edge/src/agent/intake/turn-intake.ts`), and it
   keeps running in the Durable Object's `alarm()` handler with nobody connected
   — that independence from the client connection is the architectural claim
   this step exists to falsify.

Screenshot **S4**: the moment of leaving (frames still mid-flight).

## 3 · Come back and pull the complete result

Return to the same private window (the anonymous identity lives in its cookie —
a NEW private window is a different visitor and will correctly get a 404).

In the page's DevTools console, with `SESSION` set to the id from step 1:

```js
const SESSION = "<the x-session-id value>";
const res = await fetch(`/v1/conversations/${encodeURIComponent(SESSION)}/messages`, {
  credentials: "include",
});
console.log(res.status, await res.json());
```

Check:

- Status `200`.
- `messages` alternates `user` / `assistant` and contains **all three** turns,
  oldest first — including the third one, whose answer was produced after you
  left.
- `run.status === "succeeded"` and `run.reason === null` — the run that was
  in flight when you disconnected reached its terminal state on its own.
- `revision` equals the number of turns committed.

Screenshot **S5**: the console output, with `run.status` and the third
assistant message both visible.

## 3b · Clarify → pick → route (W2-2, #1288)

The steps above never leave the model loop. This one leaves it deliberately: a
candidate pick is a DETERMINISTIC turn that skips the model entirely
(`workers/edge/src/agent/selection/`), so it is the one journey step where a
provider outage would not show up as a failure.

1. In the same window, ask something the catalog cannot resolve to one work,
   e.g. `らき☆すた` (the OVA and the series are two entries). The turn should
   answer with `"intent":"clarify"` and a card offering the candidates.
2. In that `data-response` part, read `data.clarification_id` — a small integer.
   It is the session's own counter and it is what makes a pick that arrives late
   refusable; the container publishes the same member.
3. **Click a candidate on the card.** In Network, open the new `POST /v1/chat`
   and check its request body: it carries `selected_candidate_ids` and
   `clarification_id`, and its message list ends with the pick's label bubble.
4. In the streamed frames, check that the turn:
   - opens a tool part named `plan_multi` (or `search_nearby` for a place
     clarification) — this is a SERVER-initiated step, so its
     `tool-input-available` carries `"input":{}`;
   - closes with `"intent":"plan_multi"` and a `data` carrying BOTH `results`
     and `itinerary`;
   - shows **no** provider latency — the answer arrives in roughly one catalog
     round trip, because no model was called.
5. **Click the pick again** (or re-send the same body from the console). The
   question has been consumed, so the second pick answers
   `"intent":"clarify"`, `"success":false`, `"status":"invalid_request"` and
   `errors[0].code === "invalid_selection"`. That refusal IS the stale guard;
   a second route is the failure.
6. On a route card, tick a subset of the spots and use the page's own
   "recompute" affordance. Its `POST /v1/chat` carries `selected_point_ids` and
   a part-less user message, and the answer is `"intent":"plan_selected"`.

Screenshot **S5b**: the clarify part with `clarification_id` visible.
Screenshot **S5c**: the pick's request body next to the `plan_multi` answer.
Screenshot **S5d**: the second pick's `invalid_selection` refusal.

> **What to check, not just that a route appeared:** step 5 is the whole point.
> A pick that routes twice means the clarification is not being consumed, and
> the session would then accept a card the user is looking at long after it
> stopped being the question.

## 4 · The refusals are real too (optional but cheap)

- **Cross-visitor read**: repeat step 3's fetch in a *different* private window.
  Expect `404` with `{"error":{"code":"not_found"}}` — a conversation you do not
  own is answered exactly like one that does not exist.
- **Daily allowance**: `ANON_DAILY_MESSAGE_QUOTA` is 20 on staging. After 20
  messages from one anonymous identity in one UTC day the 21st answers `403`
  with `{"error":{"code":"anon_quota_exhausted","data":{"quota_resets_at":…}}}`.
  Screenshot it if you happen to hit it; do not spend 20 turns manufacturing it.

## 5 · Rollback

If any step above fails in a way that hurts real usage, the rollback is one word:
set `AGENT_TURN_ROUTE = "container"` in `[env.staging.vars]` and let CD deploy it.
No code change, no revert — the container path is untouched by this card and the
routing tests pin both positions
(`workers/edge/test/agent-turn-routing.test.ts`).

## Recording the result

File the screenshots and the verdict on the W1-7 issue (#1256). The journey
passes only if **S5** shows the third assistant message and `run.status:
"succeeded"`; everything before it is context for reading a failure.
