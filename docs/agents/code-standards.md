# Code standards the root guide does not state

`AGENTS.md` carries 1-10-50, no `any`, no suppressions and the TypeScript gate;
`.claude/rules/naming-ownership.md` carries naming by ownership and the line-limit rule. This
file holds the owner's standing methodology decisions and the habits that cost real time.

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

## An approved exception to a rule (owner, 2026-10-14 and 2026-10-15)

A suppression or an exemption from a written rule waits for the owner (`AGENTS.md`, "No suppression
without user approval"; the escalation path in `docs/agents/harness.md`). Once approved, an
exception to any rule (a lint rule, a scanner advisory, a type check) carries the same things:

- The cause is found before the exception is asked for: of a lint pass that peaked at 4.3 GB per
  file the owner said "为什么内存占用这么多，我感觉有点问题" (2026-10-15), and nothing was relaxed until
  the cause was known.
- It is scoped to the named files or directories, not the package or the repository.
- The configuration states the reason, the upstream issue and an expiry date.
- It is removed when upstream fixes the cause; extending it is the owner's decision again (the osv
  ignore in `docs/agents/owner-decisions.md`, extended on 2026-10-14).

Each point comes from an owner decision on one exception: the oxlint rule (2026-10-15: find the
cause, scope it to one directory, state the reason and link upstream, delete it when upstream fixes
it) and the osv ignore (a dated window the owner extended). Applying them to every exception, with
the expiry date required, is the controller's ruling of 2026-11-01.

A dependency held below its latest release is such an exception, and its configuration is the
register line in `pnpm-workspace.yaml`:
`# hold-back: <package>@<declared> -> <latest> fails <gate> — #<issue>, expires <YYYY-MM-DD>`.
The gate is the reason, the issue is the follow-up that retires the pin, and from the expiry date
`test/repo-config/dependency-hold-back-expiry.test.rb` is red until the pin goes or the owner
extends the date; a line without a date is refused (`docs/agents/package-managers.md`).

## No backward-compatibility shims (owner)

"不需要考虑后向兼容，只要能够完成当前的功能不变 随便重构": refactor freely, keep current behaviour
working, and update every caller directly. No re-export layers, delegation shims or compatibility
wrappers.

## Latest dependencies, official usage, research before writing (owner, 2026-07-18)

- Dependencies go to latest; a breaking change is migrated, not pinned around.
  - Except the Pi packages: see the pi version line in `docs/agents/owner-decisions.md`.
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

## A test stubs `fetch` before its first request

A test whose code can make a request installs its stub before the first call that can reach the
network — in the test's setup, never after the code under test has run. A red run is still a run:
a test that fails, including a TDD test written to fail first, has already sent every request its
code made, so "it failed" never means "it did nothing". A test pool should refuse an outbound
request that no stub answers, so that a missing stub fails the test instead of reaching the network.

Why: on 2026-11-14 a catalog worker test called the global `fetch` before it stubbed it, and the
workerd test pool sent the requests on — one to `api.bgm.tv`, which answered, and up to three to
the deployed egress service (`apps/anitabi-egress`), which refused them at transport. `AGENTS.md`
forbids a test to request a third-party upstream, and nothing in the run enforced that: a
`@cloudflare/vitest-pool-workers` pool passes a worker's outbound requests through to the network
unless its configuration routes them elsewhere. Miniflare, which runs the pool, gives a worker no
outbound override by default, and without one its requests go out.

Miniflare also sends a request of its own. With its `cf` option unset, it reads a cached
`Request.cf` object younger than 30 days or fetches one from
`https://workers.cloudflare.com/cf.json`, unless `NODE_ENV` is `test`. A failed fetch logs a
warning, but Miniflare's default log prints nothing at any level, so only a starter that passes a
log of its own, as Wrangler's test harness does, shows it (Miniflare 4.20260730.0's source). Vitest
sets `NODE_ENV` to `test` when it is unset; node's test runner does not. `workers/api`'s bundle
smoke runs on node's test runner: in a sandbox that refused the fetch, all eleven of its starters
attempted it and only the Wrangler harness printed the warning, and in CI, where nothing refuses
it, every run called Cloudflare (#2116, 2026-11-24). A machine that holds a cached copy younger
than 30 days shows no attempt at all. A Miniflare starter turns the fetch off with `cf: false` on
each instance (`workers/api/bundle-smoke/placeholder-request-cf.ts`), or with
`CLOUDFLARE_CF_FETCH_ENABLED=false` where a harness takes no `cf` option. Miniflare honours only
`false` there, in any letter case: `0` or an empty value leaves the fetch on.

## Loading a module on first use (2026-11-24)

#2117 put the migrator's Prisma control behind a memoized `import()`, and #2119 did the same for
the catalog and users Workers. The facts below shaped those changes; each was checked against
esbuild 0.28.2 or Vitest 4.1.12.

- **esbuild drops a bare import of a package that declares `"sideEffects": false`,** with an
  `ignored-bare-import` warning. Such an import cannot force a module to evaluate, and a mutant
  that adds one is equivalent, as #2117 argued for one item of its failure list.
- **esbuild's `__commonJS` wrapper runs a module again after it threw;** its `__esm` wrapper for an
  ES module rethrows the first error. A memo that retried would re-run such a module on every
  request and could not succeed with the same bytes, so the memo keeps the rejection for the
  isolate's life (`workers/migrator/src/prisma-first-use.ts`; in the catalog's graph `pg` is such
  a module, `workers/catalog/src/db/prisma-first-use.ts`).
- **Behind `import()`, esbuild wraps the target's whole dependency graph in lazy initializers,**
  which grew the migrator's upload by 449 KiB (#2117) and the catalog's and users' by about 10%
  (#2119). A module the eager code shares with that graph then evaluates when an initializer first
  calls it, which can be later than in the eager bundle: eager code that reaches it through a
  side-effect-free re-export can run before it exists. Boot the release build after such a change.
- **In Vitest, count module loads at the module the code under test imports.** One level down, a
  failed evaluation is cached, so a retry never reaches a counter there; a `vi.mock` factory that
  throws runs again on a later import of its own module.
  `workers/migrator/test/prisma-first-use.test.ts` and
  `workers/catalog/test/prisma-first-use.worker.test.ts` count there for that reason.
