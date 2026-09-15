/**
 * The one `EVAL_TRACE_SAMPLE_RATE` reader: the preload configures Logfire's head sampler and the
 * run records the same value in its report metadata, so an unset or empty variable must mean one
 * thing — the full-sample default — rather than a default in one caller and zero in the other.
 */
export function traceSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new RangeError('EVAL_TRACE_SAMPLE_RATE must be a number between 0 and 1');
  }
  return parsed;
}
