import type { EvaluationReport, ReportCase, ReportCaseFailure } from 'logfire/evals';

import { caseSubmissionsOf } from '../case-submissions.ts';
import type { ExportedAgentInput } from '../dataset-roundtrip.ts';

/**
 * What a staging run spent, as far as the wire can witness it.
 *
 * TOKENS AND DOLLARS ARE NOT HERE, and that is a measurement, not an omission.
 * Python reads them off `AgentResult.usage` — an in-process object
 * (`exec_tiers._output_usage`). The SD-9 stream publishes no usage part and
 * `GET /v1/conversations/{id}/messages` carries a run status and nothing about
 * cost, so a TS run against the deployed edge has no honest token count to
 * write down. The dollar figure for a double run comes from the provider
 * dashboard; inventing a number here would make the result file look like it
 * had measured one.
 *
 * WHAT IS HONEST is the quota the run puts on the signed-in QA identity, and
 * that is exactly countable: `caseSubmissionsOf` is a pure function of a case's
 * inputs, so the number of `POST /v1/chat` bodies a run calls for is known from
 * the cases alone — history replays included, which is why it is not the case
 * count. It is `turns_planned` rather than `turns_sent` because a case that
 * errored may have got some of its turns away before it did.
 */
export interface RunSpend {
  /** `POST /v1/chat` submissions the run's cases call for, history included. */
  readonly turns_planned: number;
  /** Wall clock inside the task, summed over evaluated cases, in seconds. */
  readonly task_seconds: number;
}

type AttemptedCase =
  | ReportCase<ExportedAgentInput>
  | ReportCaseFailure<ExportedAgentInput>;

export function runSpendOf(
  report: EvaluationReport<ExportedAgentInput>,
): RunSpend {
  const attempted: AttemptedCase[] = [...report.cases, ...report.failures];
  return {
    turns_planned: attempted.reduce((total, entry) => total + turnsOf(entry), 0),
    task_seconds: millisecondPrecision(report.cases),
  };
}

function turnsOf(entry: AttemptedCase): number {
  return caseSubmissionsOf(entry.inputs).length;
}

/** Rounded to the millisecond: the runner cannot see finer, and a committed
 * result file should not diff on the sixteenth decimal of a float sum. */
function millisecondPrecision(
  cases: readonly ReportCase<ExportedAgentInput>[],
): number {
  const seconds = cases.reduce((total, entry) => total + entry.task_duration, 0);
  return Math.round(seconds * 1000) / 1000;
}
