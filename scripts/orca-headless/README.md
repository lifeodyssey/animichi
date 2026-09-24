# Orca headless launcher

This dependency-free local CLI fills Orca 1.4.206's headless worker-launch gap. Orca remains the
only Run, Task, Dispatch, message, and settlement authority; this directory only launches a
noninteractive model process and records private receipts and transcripts.

## Start

Pass an existing absolute workspace and a new absolute state directory outside that workspace:

```sh
ruby scripts/orca-headless/orca-headless.rb start \
  --workspace /absolute/existing/workspace \
  --coordinator term_native_coordinator \
  --run run_native_run \
  --title "Implement issue" \
  --spec-file /absolute/role-spec.md \
  --provider codex \
  --model gpt-5.6-sol \
  --effort max \
  --state-dir /absolute/private/attempt-directory \
  --runtime-client /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/runtime/client.js
```

The accepted fixed selections are `codex/gpt-5.6-sol/max`, `codex/gpt-6-astra/xhigh`,
`grok/grok-4.6/xhigh`, `pi/opencode-go/deepseek-v4.1-flash/max`, `pi/bigmodel/glm-5.3-flash/max`,
`pi/opencode-go/mimo-v2.5-pro/max`, `pi/opencode-go/mimo-v2.5/max`, `claude/claude-opus-5/max`,
and `kimi/kimi-code/k3-256k-max/max`.
Selection is explicit; the launcher has no router, provider pool, quota policy, scheduler, review
algorithm, or retry loop.
Role specs must tell the worker to invoke Matt `/implement` or `/code-review` as appropriate.

The launch receipt's provider, model, effort, and argv fields describe the requested selection;
they are not provider-reported effective identity and do not approve an independent review. For pi
the recorded model is the provider-qualified id `opencode-go/deepseek-v4.1-flash`, so `modelArgv`
carries the complete fixed selection. The coordinator verifies effective provider/model/effort from
the provider session separately before admitting developer or reviewer evidence.

Codex runs `codex exec` with `--approve-for-me` and the user's normal configuration and
permissions. Grok runs with `--prompt-file`. Pi runs `pi --print` with
`--model opencode-go/deepseek-v4.1-flash`, `--thinking max`, and `--approve`; print mode with
non-TTY stdio keeps pi out of its TUI and Chat UI, and `--approve` trusts project-local files for
that one run so a trust prompt cannot block the worker. Claude runs `claude --print` with
`--model claude-opus-5`, `--effort max`, and `--permission-mode bypassPermissions`; print mode
with non-TTY stdio keeps claude out of its interactive UI and skips the workspace trust dialog,
and `bypassPermissions` is the narrowest permission mode that cannot block on a prompt while
still letting the worker edit files and run its gates, so it bypasses permission prompts rather
than hooks or a sandbox. No path disables hooks or bypasses a sandbox.

The native Dispatch preamble is atomically published byte-for-byte to a private file only after
Orca creates the Dispatch. Model stdin, stdout, and stderr are files, never an agent TUI or Chat UI.
Pi reads that pinned prompt file on stdin as its initial message and trims surrounding whitespace
while merging it, and claude reads the same file on stdin unchanged, so the private file stays the
byte-exact record of what each was asked to run.
Codex and Grok stream structured events into the `events.jsonl` stdout receipt; pi's and claude's
`--print` responses are plain text and land in `output.txt`.

The state directory must not already exist. It is created as mode `0700`; receipts, the preamble,
and logs are mode `0600`. Receipt publication is atomic no-replace, removes its pending file, and
syncs the parent directory before returning. A duplicate `start` refuses before contacting the
runtime so it cannot create a second terminal or Task for the same attempt. The terminal command
uses `exec`, and the wrapper holds the PTY after recording the model child's exit; this prevents the
old exit receipt from authorizing cleanup of a later shell or agent. If the child starts but its
process receipt cannot be committed, the runner terminates and reaps only that exact new PID; a
successful abort is recorded in `process-abort.json`, while cleanup uncertainty remains an error.

## Inspect

```sh
ruby scripts/orca-headless/orca-headless.rb status \
  --state-dir /absolute/private/attempt-directory
```

Status combines fresh native `worker-show` and terminal identity evidence with local child-process
receipts. It reports model CLI exit, Task settlement, and candidate approval separately. Missing,
stale, inconsistent, or unsupported observations remain `unknown`; model exit does not imply a
settled Task or an approved candidate.

## Cleanup

After the coordinator has accepted the attempt's real `worker_done`, pass that message ID:

```sh
ruby scripts/orca-headless/orca-headless.rb cleanup \
  --state-dir /absolute/private/attempt-directory \
  --settlement-message msg_native_worker_done
```

Cleanup requires all of the following positive evidence: the wrapper recorded the exact child
exit and entered its post-exit hold; Orca reports the recorded Task/Dispatch as settled; the named
`worker_done` binds the same Run, Task, Dispatch, terminal, and outcome; and the current terminal,
PTY, incarnation, workspace, and wrapper ownership still match. The settlement read is performed
as the Run's current coordinator, learned from the runtime's own `orchestration run-show` record
for the attempt's Run ID and never accepted from a flag; because the runtime attests the calling
process against that handle, a `run-use` seat move does not strand settled lanes, and a caller
that is neither the launch-time nor the current coordinator is fenced (`consumer_fenced`) before
any mutation. Cleanup always observes the recorded
local wrapper PID through native process inspection, whether provider metadata is present or absent.
Its command must still be the exact recorded runner command, its TTY must still be attached and
foreground-owned by its process group, and its process start must predate the wrapper's ready receipt;
missing, malformed, reused-PID, or mismatched evidence refuses cleanup. This lets fresh wrapper proof
distinguish cached provider metadata after model exit from a real process takeover. Cleanup calls
`worker-release` first and accepts only Orca 1.4.206's low-level result
`retained/no_owned_resource/processAction none`. It then rechecks identity, closes only that exact
terminal, and requires `ptyKilled: true`. There is no force or blanket-close option. A repeat is
successful only when the saved close receipt positively proves that earlier close.

## Compatibility and recovery

The background terminal creation bridge uses Orca's unsupported internal `RuntimeClient` seam:
Orca **1.4.206** at the explicit `--runtime-client` path. It requires the matching live runtime,
ready graph, `terminal.create-idempotency.v2`, and `orchestration.contract.v1`; any mismatch is a
hard failure with no visible-mode fallback. Lifecycle operations use the public `orca` CLI.

Every mutation intent and response is retained in the attempt directory. On a failed or ambiguous
stage, do not rerun `start`, invent an ID, create another Task, or delete residual resources. Keep
the directory, inspect its last exact request/response alongside native `worker-show`,
`dispatch-show`, and `request-show` evidence, and let the coordinator decide manual recovery. An
ambiguous release or close is not automatically retried. This launcher does not mutate GitHub,
create worktrees, approve candidates, publish changes, or claim that a business workflow ran.
