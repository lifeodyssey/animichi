import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { DOCUMENTED_INVOCATIONS, invocationLine, rejectArguments,
  type DocumentedInvocation } from '../src/native/native-command.ts';

const run = promisify(execFile);
const REPOSITORY_ROOT = new URL('../../../', import.meta.url);
const NATIVE_DOC = new URL('../NATIVE.md', import.meta.url);
const RETIRED_ARGUMENTS = ['--dataset', 'agent_eval_v3'];
const AMBIENT_CONTROLS = ['CATALOG_API_URL', 'EVAL_COMMIT', 'EVAL_DATASET', 'EVAL_DRY_RUN', 'EVAL_MODEL',
  'EVAL_PROVIDER', 'EVAL_REPORT_PATH', 'EVAL_SMOKE', 'LOGFIRE_TOKEN', 'MIMO_API_KEY', 'OPENCODE_API_KEY'];

void test('NATIVE.md quotes every documented invocation verbatim', async () => {
  const lines = (await readFile(NATIVE_DOC, 'utf8')).split('\n');
  const missing = Object.values(DOCUMENTED_INVOCATIONS).map(invocationLine).filter((line) => !lines.includes(line));
  assert.deepEqual(missing, []);
});

void test('the command refuses a stray argument instead of running a default', () => {
  rejectArguments([]);
  assert.throws(() => { rejectArguments(['--', ...RETIRED_ARGUMENTS]); }, /takes no arguments/);
});

void test('the documented offline invocation prints the plan without a credential', async () => {
  const { stdout } = await runInvocation(DOCUMENTED_INVOCATIONS.plan);
  const plan = JSON.parse(lastLine(stdout)) as Record<string, unknown>;
  assert.deepEqual({
    dataset: plan.dataset, provider: plan.provider, smoke: plan.smoke,
    sourceCases: plan.sourceCases, selectedCases: plan.selectedCases, commit: plan.commit,
  }, {
    dataset: 'agent_eval_heldout_v1', provider: 'xiaomi', smoke: true,
    sourceCases: 33, selectedCases: 3, commit: await headCommit(),
  });
});

void test('the retired flag form fails instead of silently running the default set', async () => {
  await assert.rejects(runInvocation(DOCUMENTED_INVOCATIONS.plan, RETIRED_ARGUMENTS), refused);
});

function runInvocation(invocation: DocumentedInvocation, extra: readonly string[] = []) {
  return run('pnpm', [...invocation.argv, ...extra], { cwd: REPOSITORY_ROOT, env: invocationEnvironment(invocation) });
}

/** The documented environment with ambient credentials and controls removed. */
function invocationEnvironment(invocation: DocumentedInvocation): NodeJS.ProcessEnv {
  const ambient = Object.entries(process.env).filter(([name]) => !AMBIENT_CONTROLS.includes(name));
  return { ...Object.fromEntries(ambient), ...invocation.environment };
}

function refused(error: unknown): boolean {
  if (!(error instanceof Error) || !('stderr' in error)) throw error;
  assert.match(String(error.stderr), /takes no arguments/);
  return true;
}

function lastLine(output: string): string {
  const line = output.trimEnd().split('\n').pop();
  if (line === undefined) throw new Error('the documented invocation printed nothing');
  return line;
}

async function headCommit(): Promise<string> {
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT });
  return stdout.trim();
}
