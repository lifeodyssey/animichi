/**
 * Replay the recorded selection corpus against the real catalog (#1558).
 *
 * This is the deterministic suffix of `phase1c_selection_v1`: no model is
 * called (`model_calls: 0`), each case forks its own frozen source, and the
 * production `executeSelection` resolves the offered candidates exactly as the
 * host does when a partner clicks one. The report proves — per case — the
 * candidates, revision and durable reference the fork carries, and the
 * selection it produced.
 *
 * It needs a catalog origin but no model credential:
 * `CATALOG_API_URL` is required and is the only host a rewritten catalog
 * request can reach. `EVAL_PREFIX_SELECTION_REPORT` chooses the JSON path;
 * otherwise the artifact lands in the OS temporary directory.
 */
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { configuredCatalog } from '../src/native/catalog-fetch.ts';
import { reportFaults, runPrefixSelection, type SelectionReplayReport } from '../src/native/prefix-selection.ts';
import { readRunConfig } from '../src/native/native-run.ts';

const DATASET = 'phase1c_selection_v1';

/** The replay needs the real catalog and a tested commit; it never reads a credential. */
export function readSelectionReplayConfig(env: NodeJS.ProcessEnv = process.env): { catalogUrl: string; commit: string; reportPath: string } {
  const catalogUrl = env.CATALOG_API_URL;
  if (!catalogUrl?.trim()) throw new Error('replaying the prefix selection requires CATALOG_API_URL');
  return { catalogUrl, commit: readRunConfig({ ...env, EVAL_DATASET: DATASET }).testedCommit,
    reportPath: env.EVAL_PREFIX_SELECTION_REPORT ?? join(tmpdir(), `prefix-selection-${DATASET}.json`) };
}

export async function replayConfiguredSelection(
  config: { catalogUrl: string; commit: string; reportPath: string },
): Promise<SelectionReplayReport> {
  const report = await runPrefixSelection(DATASET,
    { catalog: configuredCatalog(config.catalogUrl), commit: config.commit }, BACKGROUND_CONTEXT);
  await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

/** One line per case: the verified boundary state and the selection it produced. */
export function formatReport(report: SelectionReplayReport): string {
  const lines = [`${report.dataset}: ${String(report.cases.length)} cases, model calls ${String(report.model_calls)}, commit ${report.commit}`];
  for (const entry of report.cases) {
    lines.push(`  ${entry.status} ${entry.name}: ${entry.selection_status ?? 'refused'} `
      + `clarification=${String(entry.clarification_id)} reference=${entry.reference.entry_id} rows=${String(entry.row_count)}`);
    for (const fault of entry.faults) lines.push(`    ${fault}`);
  }
  return lines.join('\n');
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) void main().catch(reportError);

async function main(): Promise<void> {
  const config = readSelectionReplayConfig();
  const report = await replayConfiguredSelection(config);
  process.stdout.write(`${formatReport(report)}\n`);
  process.stdout.write(`prefix selection report: ${config.reportPath}\n`);
  failOnFaults(report);
}

function failOnFaults(report: SelectionReplayReport): void {
  const faults = reportFaults(report);
  if (faults.length === 0) return;
  process.stderr.write(`${faults.join('\n')}\n`);
  process.exitCode = 1;
}

function reportError(error: unknown): void {
  process.stderr.write(`prefix selection replay failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
