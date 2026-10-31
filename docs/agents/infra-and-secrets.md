# Infra and secrets — operational discipline

Policy: `docs/adr/0003-secrets-architecture.md` (where each secret lives) and
`docs/adr/0008-platform-over-handwritten.md`; inventory: `docs/ops/secrets.md`; IaC rules:
`.claude/rules/infra.md`. This file holds the incidents that produced the discipline.

## Secrets come from the platform, not from hands (owner, 2026-09-15)

"我预想的就是这些 secret，它应该全部都是用 pulumi 的那种语法方式获得的，我们不需要手动管理." If a provider
can mint a value (a Cloudflare resource's secret, `random.RandomPassword`), declare it in Pulumi
and wire the output; vendor-issued keys nobody can mint go into ESC once, as `fn::secret`. The
same day the owner named the failure. Values had been copied from a local `.env` into ESC before
anyone checked that `cloudflare.TurnstileWidget` and `random` (already a dependency) solved it:
"用我们这些组件库已经解决的方式来做，而采取了手动的方式来做，这是一个很典型的例子". Before any manual
operational step (copying a secret, clicking a dashboard, a one-off API call), check whether the
provider or an existing component already models it, and propose that. Token permissions (for
example Turnstile edit on the CD Cloudflare token) are owner actions.

## Values never enter chat, PR bodies, docs or logs

Credentials have leaked through session transcripts here twice (a Turnstile secret, 2026-07-26; a
Logfire read token, 2026-07-29, rotated twice because the replacement was pasted back into the
chat). Any channel that retains and is searched (chat, PR body, docs, CI logs) owns a value's
lifetime once it is written there, and a rotation reported by pasting the new value starts the loop
again.

- If the task can be done without knowing the value, the value is not provided: configuring an
  MCP server, writing docs, changing CI, opening an issue.
- Writes go through the platform command with the value on stdin, executed by the owner in their
  own terminal; the value never appears in a command line or a transcript.
- When a secret must be referred to, report the prefix and the length only.
- When the owner says a credential is being rotated, leave it: do not read secret timestamps or
  predict failures ("你能不能忘记轮换的事情，谁让你看了", 2026-08-06).
- Session transcripts and logs (`~/.pi`, `~/.claude`, `~/.codex`, any `projects/*.jsonl`) are not a
  source of samples or fixtures. Nothing from them enters the repository, a push or any model,
  reviewers included; samples are built from the repository or public documentation, with the
  source named. A writer once committed provider responses lifted from the owner's transcripts
  as fixtures (2026-10-22); every brief that asks for recordings says so.
- Issues, pull requests and their comments in this repository are public: internal endpoints,
  project identifiers and paths on the owner's machine do not go there ("这个url不要写到issue的comment里，issue是公开的",
  2026-07-07). What must be kept goes on the private tracker card ("你可以写进卡里，卡是private的").

## Environments: staging and production, nothing else (owner, 2026-07-29 to 2026-09-05)

There is no dev environment ("我们没有dev，只有staging prod", 2026-08-14). Staging is the preview,
so pull requests get no preview deployments ("pr预览关掉吧 实际上staging是我们的预览分支",
2026-07-29). Staging holds only synthetic test users and synthetic data ("staging 只能包含合成测试用户和合成用户数据",
2026-08-12), and only a fixed set of people can sign in to it ("我不希望除了固定的人之外能够登录staging",
2026-09-05; Cloudflare Access, `docs/agents/owner-decisions.md`).

## Stale is not invalid; prove before replacing (2026-08-05 outage)

A working credential was replaced because its timestamp was older than another copy's; the
replacement came from the local `.env`, which was itself stale; the infra lane went red one minute
after the write and stayed red. Timestamps are not evidence of validity. Write-only stores make a
replacement irreversible.

1. Prove a credential invalid with a read-only call before touching it (a bucket listing, a
   token-verify endpoint); the test takes ten seconds.
2. Verify the candidate value locally before writing it anywhere.
3. The local `.env` is not a source of truth; it is a developer machine's residue. It is evidence
   of nothing, but it is the first place to look for a value: take what you need from it or from
   the platform CLI (`neonctl`, `wrangler`, `gh`, `pulumi env`) before asking the owner ("本地.env没有嘛，或者你可以用cli来获取",
   2026-09-09).
4. Confirm the rollback path exists before deleting.
5. When something goes red, align timelines first: when did the first red run start, and what was
   the last human change before it.

Script the discipline instead of remembering it: values arrive on stdin or from a hidden prompt,
never as arguments, the first step is the read-only verification, no verification means no write,
the write reads stdin (`printf '%s' "$v" | <tool> set NAME`), and the script reads back timestamps
at the end.

## Non-interactive CLIs write to production by default (2026-07-26)

`wrangler secret put` against a Worker that did not exist created an empty Worker: in a TTY it
asks "Do you want to create a new Worker?", in an agent's shell it prints "Using fallback value in
non-interactive context: yes" and creates it, exit code 0. Before any production write, run the
read-only existence check (`wrangler deployments list --name <x>` fails clearly when absent). If it
happens anyway, report it and leave the object; deletion is destructive and the owner decides.
Resources created to test something (a spike deployment, a temporary branch, a local dev server)
are removed when the test ends ("记得测试完之后把这些删掉", 2026-09-02); one you are not allowed to
delete, such as a Neon branch, is reported to the owner.

- `gh secret set --body -` writes a literal dash; `gh` reads stdin only when `--body` is omitted
  (`printf '%s' "$v" | gh secret set NAME --env X`). Every hyphen masked in the workflow log was
  the diagnostic (2026-08-05).
- ESC values keep any trailing newline you give them: `echo` produced a key with `\n` that
  surfaced downstream as a generic "Connection error" and failed a whole nightly run. Use
  `printf '%s' "$v" | tr -d '\r\n' | pulumi env set … --secret --file -`, then verify without
  printing: `pulumi env open … | jq '.environmentVariables.K | test("\\s")'` (2026-09-08).
- This project's Turnstile keys have been distinguishable by length (observed: site key 24
  characters, secret 35) — an observation, not a format rule. Where a key's format has structure,
  assert it at the reading point so a private-key-as-public misconfiguration fails at build time.

## Pulumi Cloud OIDC facts (2026-09-05)

`.claude/rules/infra.md` states the personal token scoped to `user:lifeodyssey`. Why it is
personal: an `organization` token request returns `401 access_denied: Org tokens are not
supported for non enterprise organizations`; the `lifeodyssey` organisation is on an individual
plan. On 2026-09-05 both issuer-policy API routes answered 404 on this organisation, so the policy
was read and changed in the console; treat that as an observation on this plan, not as "no API
exists", and check Pulumi's current API reference first. The console must hold a policy with token
type Personal and user `lifeodyssey`, or the CI login stays red.

## Identity for machine and agent callers (research, 2026-10-03)

The edge accepts only human Neon Auth JWTs and anonymous Turnstile identities; CI, an MCP client, an
A2A peer or a user-brought agent has no credential class today. Eval identity is out of scope: the
eval's system under test is the agent, not the gateway (owner, 2026-09-09).
`docs/iterations/agent-platform-research-2026-10/AGENT-AUTH-RESEARCH.md` records how A2A, MCP, the
Claude and ChatGPT connectors and the identity vendors authenticate such callers, the principal kinds
the sources distinguish (human, service, agent acting for a user) and where they disagree, an inferred
extensibility pattern (one verification seam, an issuer registry, one internal identity), our
constraints, four unranked candidate directions and the open owner questions. See it when a new
credential, identity class or Access change comes up; its §6 questions are open until a decision
lands in `docs/agents/owner-decisions.md`.
