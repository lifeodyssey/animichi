import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logfireConfig } from '@pydantic/logfire-node';
import type { Api, Model } from '@earendil-works/pi-ai';
import { renderReport, type EvaluationReport, type ReportCase } from 'logfire/evals';
import { plannedCases, type LoadedNativeDataset } from './evaluation-dataset.ts';
import { recordedPlanCases } from './pass-caret-k-report.ts';
import type { NativeCaseMetadata, NativeOutput, NativeTaskInput } from './evaluation-types.ts';

/**
 * The run facts a native report records about itself. The report owns this contract so it never
 * reaches back into the composition root: `NativeRunConfig` satisfies it structurally.
 */
export interface ExperimentProvenance {
  readonly datasetName: string;
  readonly testedCommit: string;
  readonly repeat: number;
  readonly traceSampling: number;
  readonly smoke: boolean;
}

/** Persist the SDK report itself; the rendered text is a human-readable companion. */
export async function writeEvaluationReport<I, O, M>(
  report: EvaluationReport<I, O, M>,
  path: string,
): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return renderEvaluationReport(report);
}

/**
 * The rendered companion the run prints. The SDK's `renderReport` renders name, duration, input,
 * output, scores, labels and assertions but has no attributes column, so per-case run facts
 * (`pi.usage.status`, observed tool calls) would be invisible in the text even
 * though the artifact carries them. This appends that column rather than reimplementing the SDK.
 */
export function renderEvaluationReport<I, O, M>(report: EvaluationReport<I, O, M>): string {
  const rendered = renderReport(report, { includeInput: true, includeOutput: true, includeFailures: true });
  if (report.cases.length === 0) return rendered;
  return `${rendered}\n\n${attributeTable(report.cases)}`;
}

interface AttributeRow {
  readonly attributes: string;
  readonly name: string;
}

function attributeTable(cases: readonly ReportCase[]): string {
  const rows: readonly AttributeRow[] = cases.map((entry) =>
    ({ name: entry.name, attributes: attributeSummary(entry.attributes) }));
  const header = 'name';
  const width = Math.max(header.length, ...rows.map((row) => row.name.length));
  return [`Attributes: ${String(rows.length)}`, `${header.padEnd(width)}  attributes`,
    ...rows.map((row) => `${row.name.padEnd(width)}  ${row.attributes}`)].join('\n');
}

/** One case's attributes as the SDK renders scores: a `key=value` list, `-` when empty. */
function attributeSummary(attributes: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return '-';
  return entries.map(([name, value]) => `${name}=${attributeValue(value)}`).join(', ');
}

function attributeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) || String(value);
}

/** The provenance every native report records for this run. */
export function experimentMetadata(
  loaded: LoadedNativeDataset,
  config: ExperimentProvenance,
  model: Model<Api>,
): Record<string, unknown> {
  return {
    dataset: config.datasetName,
    model: `${model.provider}:${model.id}@${model.baseUrl}`,
    commit: config.testedCommit,
    repeat: config.repeat,
    sampling: 'iid',
    trace_sampling: config.traceSampling,
    smoke: config.smoke,
    source_cases: loaded.sourceCaseCount,
    selected_cases: loaded.selectedCaseCount,
    unsupported_shapes: loaded.unsupportedShapes,
    planned_cases: recordedPlanCases(plannedCases(loaded)),
    uploader: logfireConfig.sendToLogfire ? 'configured' : 'unconfigured',
    failed_attempt_spend: 'unmeasured',
  };
}

/** Fold measured per-case spend and its coverage into the report's own metadata. */
export function addSpendMetadata(report: EvaluationReport<NativeTaskInput, NativeOutput, NativeCaseMetadata>): void {
  const known = report.cases.reduce((total, current) => total + (current.metrics['pi.cost.total'] ?? 0), 0);
  const statuses = report.cases.map((current) => current.attributes['pi.usage.status']);
  const measured = statuses.filter((status) => status === 'measured').length;
  const status = report.cases.length === 0 || measured === 0 ? 'unmeasured'
    : measured === report.cases.length && report.failures.length === 0 ? 'measured' : 'partial';
  report.experiment_metadata = { ...report.experiment_metadata, actual_spend_usd: known, actual_spend_status: status };
}
