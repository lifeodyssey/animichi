# Code standards the root guide does not state

`AGENTS.md` carries 1-10-50, no `any`, no suppressions and the TypeScript gate;
`.claude/rules/naming-ownership.md` carries naming by ownership and the line-limit rule. This
file holds the owner's standing methodology decisions and two habits that cost real time.

## Methodology mandate (owner, 2026-08-03)

"我们两边都要 follow tdd, ddd, solid, oop 和 clean archi 哦": every stack follows TDD, strategic
DDD, SOLID, OOP and Clean Architecture; the rules are the same on every side of the monorepo.

- Use cases live in an application layer; mappers are named at the boundary; an anti-corruption
  layer (a hand-copied external contract) declares itself as one.
- Dependency rules are machine-guarded, not left to discipline. `packages/agent/.oxlintrc.json`
  restricts the agent library's imports; the 2026-09-05 audit
  (`docs/specs/2026-09-05-repo-smell-audit.md`, ARCH-03) found no such guard anywhere at the
  time, so a new boundary comes with its guard.
- TDD is a process requirement (the failing test comes first), driven through the implementation
  skills. The owner's testing rules in `AGENTS.md` apply.
- Tactical DDD (aggregate roots, domain events, CQRS) is not authorised. Introduce a pattern only
  when it can name the invariant it protects.
- Data access is reviewed for N+1 queries and the time complexity of its SQL (owner, 2026-08-12:
  "还有n+1以及sql的时间复杂度").
- KISS and YAGNI bound the rest: before adding a step, a lock or a layer, answer what breaks without
  it ("我们是不是在某些地方过度工程了 要kiss and yangi", 2026-09-05; "你这个定的太细了，啥pre
  flight，过度工程了吧", 2026-08-12).
- Source code is written in English: identifiers and comments ("写代码不要用中文", 2026-08-29, when
  Chinese comments appeared in new code). User-facing text goes through the app's i18n.

## No backward-compatibility shims (owner)

"不需要考虑后向兼容，只要能够完成当前的功能不变 随便重构": refactor freely, keep current behaviour
working, and update every caller directly. No re-export layers, delegation shims or compatibility
wrappers.

## Latest dependencies, official usage, research before writing (owner, 2026-07-18)

- Dependencies go to latest; a breaking change is migrated, not pinned around.
- A library is used the way its own documentation recommends today, and the overall shape follows
  current community practice plus clean code and clean architecture. When the standard is unknown,
  research it (context7, the official docs, the stack skills in `docs/agents/tool-routing.md`)
  rather than writing from training memory.
- Briefs carry the research obligation; reviews check "is this the current official usage".

## Official SDKs over hand-written clients (owner, 2026-06-23)

If an official SDK or action exists, use it; a hand-written connection or client layer is a
reinvention the repository then maintains. Today that means Prisma 8 for the data plane, the pi
harness and its public `AgentHarness` API for the agent (no custom execution envelope), and
official, SHA-pinned GitHub Actions (`pulumi/*` today) before a `run:` block that reimplements
one. No adapter layer between our code and the SDK: use the library's public API the way it
documents, even when that means deleting and rewriting ("我发现agent和eval重写里有adaptor，我不希望这个，我希望采用最clean，最符合对应依赖库的方法，可以大幅删减重写",
2026-09-09).

## Line limits are met by design, not by trimming (owner, 2026-09-17)

The rule, its forbidden shortcuts and the two incidents behind it are in
`.claude/rules/naming-ownership.md`.

## `pnpm exec`, never a bare `npx <bin>`

Repository tools run as `pnpm --filter <pkg> exec <bin>`, which resolves workspace dependencies
only — never a bare `npx <bin>`. After a rebase or checkout, `pnpm install --frozen-lockfile`
before using any bin. Why: in a worktree without `pnpm install`, `npx lhci` fetched a squatted
`lhci` package from the registry (the official one is `@lhci/cli`), and only the absence of install
scripts kept it harmless (2026-08-05). If `npx` output names a package you did not expect, stop
and inspect `~/.npm/_npx`.
