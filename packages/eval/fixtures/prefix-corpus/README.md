# Recorded prefix corpora (frozen)

`<name>.json` is a `Dataset`-format manifest; `<name>/` holds one frozen format-4 JSONL
session per case. Both are committed inputs recorded through the production harness by
`scripts/record-captures.ts` (#1558) — the case inputs come from
`datasets/canonical/phase1c_selection_v1.json`, the trajectories never do.

Every manifest case carries:

- `inputs.prefix` — the frozen source file, its session id and the boundary it froze;
- `metadata.recording` — SDK version, provider, model, production prompt hash, the seven
  production tool names, the tested commit, the recording boundary and the catalog source;
- `metadata.prefix_state` — the pending selection (reason, candidates, clarification
  revision, entry id), the durable search reference, and the bounded application scalars the
  tested action needs;
- `metadata.expected_next_action` — the constraint set the evaluated suffix must satisfy.

The committed `phase1c_selection_v1` corpus was recorded deterministically
(`EVAL_RECORD_MODE=deterministic`), so its provenance reads `provider: faux`,
`model: faux-model`, `catalog: deterministic-case-fixture`. It is reproducible with:

```sh
EVAL_RECORD_MODE=deterministic EVAL_DATASET=phase1c_selection_v1 \
  pnpm --filter @animichi/eval eval:record-captures
```

Entry ids are minted by the SDK, so a recording is canonicalized before it is frozen:
`src/native/prefix-canonical.ts` rewrites every session-minted identifier (`op-0001`,
`entry-0007`, `call-0002`) to an ordered placeholder and every classified clock reading to
the recording epoch, and refuses any identifier or clock it does not classify. The committed
corpus therefore carries zero-entropy, human-readable placeholders, and re-recording the same
commit rewrites these exact bytes — `test/native-prefix-committed.test.ts` asserts that byte
for byte. Do not hand-edit a frozen source: it is the prefix a fork replays, and
`src/native/prefix-corpus.ts` fails the load when a case's source is absent.
