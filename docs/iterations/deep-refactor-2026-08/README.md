# Deep refactor 2026-08

This iteration replaces the completed skeleton campaign with a code-first deep refactor. The owner interview fixed the product seams, including removal of automated retention from campaign source and staging without replacement until a separate pre-production data-lifecycle decision. Codex Sol and OpenCode DeepSeek v4 Flash approved the final focused round with no blocking findings or owner questions, and the owner signed off v9 on 2026-08-10. The Spec is published as GitHub #936; `/to-tickets` published #937–#963 as 27 native sub-issues with verified blocking edges. Abandoned turns use bounded demand-driven recovery in local development and staging, while production no-traffic liveness remains outside the campaign. Execution has started with SAFE-1: its characterization commit is green, and the manifest/resolver implementation is paused at a clean recovery point. All later cards remain blocked until SAFE-1 merges to `main`.

| Artifact | Purpose |
|---|---|
| [Execution protocol](./EXECUTION.md) | Canonical resumable sequence, card state machine, current SAFE-1 recovery point, gates, evidence, and staging hard cut |
| [WORKSPACE-BASELINE.md](./WORKSPACE-BASELINE.md) | Time-stamped clone, branch, worktree, and patch authority snapshot |
| [Deep code refactor spec](../../specs/2026-08-10-deep-code-refactor-spec.md) | Owner-approved and published behavior, architecture, testing, and delivery contract |
| [Round-1 findings](./reviews/round-1-findings.md) | Codex Sol and OpenCode DeepSeek verdicts, evidence, and dispositions |
| [Round-4 approval](./reviews/round-4-approval.md) | Final Codex Sol and OpenCode DeepSeek confirmation after the sole round-3 correction |
| [Published tickets](./tickets.md) | GitHub issue numbers and exact blocking graph produced by `/to-tickets` |
| [Spec issue #936](https://github.com/lifeodyssey/animichi/issues/936) | Parent tracker with 27 native sub-issues |

The glossary and hard-to-reverse decisions live in `CONTEXT-MAP.md`, package `CONTEXT.md` files, and ADRs 0006–0009. This directory stores operational iteration context only.
