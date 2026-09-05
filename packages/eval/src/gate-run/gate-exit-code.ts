import type { GateRunResult } from './gate-run-result.ts';

/**
 * `run_agent_eval.gate_exit_code`: only a failure blocks.
 *
 * The three-way verdict collapses to two here, and the collapse is the point —
 * `indeterminate` and a metric that had too few paired cases are reported as
 * warnings and exit zero, because a gate that blocked on "not enough evidence"
 * would block on noise. Python's third answer (`None`, "baseline created")
 * has no counterpart: this runner never writes the record it is judged by.
 */
export function gateExitCode(result: GateRunResult): number {
  return result.failures.length > 0 ? 1 : 0;
}
