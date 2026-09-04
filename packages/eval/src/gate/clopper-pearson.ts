import { exactSum } from './python-sum.ts';
import {
  DEFAULT_CONFIDENCE,
  type Comparison,
  type Interval,
  type Verdict,
} from './paired-bootstrap.ts';

/**
 * `stats.py`'s exact binomial interval and the harmful-rate comparison built
 * on it.
 *
 * Error counts are small and often zero, where a normal approximation is
 * simply wrong, so the bound is found by inverting the binomial tail with 60
 * bisection steps — the same loop, the same term order, the same exact
 * summation as Python.
 */

export const CLOPPER_PEARSON_METHOD = 'clopper-pearson';
export const DEFAULT_PROPORTION_MIN_EFFECT = 0.02;
const BISECTION_STEPS = 60;

export interface ProportionOptions {
  readonly confidence?: number;
  readonly minEffect?: number;
}

/** The exact binomial interval, by inverting binomial tails. */
export function clopperPearsonInterval(
  events: number,
  total: number,
  confidence: number = DEFAULT_CONFIDENCE,
): Interval {
  validateProportion(events, total, confidence);
  const alpha = (1 - confidence) / 2;
  const coefficients = binomialCoefficients(total);
  return {
    lower: events === 0 ? 0 : lowerBound(events, total, alpha, coefficients),
    upper: events === total ? 1 : upperBound(events, total, alpha, coefficients),
  };
}

/** Compare harmful-event rates using exact small-sample intervals. */
export function proportionComparison(
  currentEvents: number,
  currentTotal: number,
  baselineEvents: number,
  baselineTotal: number,
  options: ProportionOptions = {},
): Comparison {
  const { confidence = DEFAULT_CONFIDENCE, minEffect = DEFAULT_PROPORTION_MIN_EFFECT } = options;
  const current = clopperPearsonInterval(currentEvents, currentTotal, confidence);
  const baseline = clopperPearsonInterval(baselineEvents, baselineTotal, confidence);
  const estimate = currentEvents / currentTotal - baselineEvents / baselineTotal;
  const interval = {
    lower: current.lower - baseline.upper,
    upper: current.upper - baseline.lower,
  };
  const verdict = proportionVerdict(estimate, interval, minEffect);
  return { verdict, estimate, interval, sampleSize: currentTotal, method: CLOPPER_PEARSON_METHOD };
}

export function proportionVerdict(
  estimate: number,
  interval: Interval,
  minEffect: number,
): Verdict {
  if (estimate <= minEffect) {
    return 'pass';
  }
  return interval.lower > minEffect ? 'fail' : 'indeterminate';
}

function validateProportion(events: number, total: number, confidence: number): void {
  if (total <= 0) {
    throw new RangeError('total must be positive');
  }
  if (events < 0 || events > total) {
    throw new RangeError('events must be between zero and total');
  }
  if (confidence <= 0 || confidence >= 1) {
    throw new RangeError('confidence must be between zero and one');
  }
}

function lowerBound(
  events: number,
  total: number,
  alpha: number,
  coefficients: readonly number[],
): number {
  return bisectProbability(
    (probability) => binomialTail(events, total, probability, coefficients),
    alpha,
    true,
  );
}

function upperBound(
  events: number,
  total: number,
  alpha: number,
  coefficients: readonly number[],
): number {
  return bisectProbability(
    (probability) => binomialCdf(events, total, probability, coefficients),
    alpha,
    false,
  );
}

function bisectProbability(
  probability: (candidate: number) => number,
  target: number,
  isIncreasing: boolean,
): number {
  let lower = 0;
  let upper = 1;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const midpoint = (lower + upper) / 2;
    const below = probability(midpoint) < target;
    [lower, upper] = below === isIncreasing ? [midpoint, upper] : [lower, midpoint];
  }
  return (lower + upper) / 2;
}

function binomialCdf(
  events: number,
  total: number,
  probability: number,
  coefficients: readonly number[],
): number {
  return exactSum(binomialMasses(0, events, total, probability, coefficients));
}

function binomialTail(
  events: number,
  total: number,
  probability: number,
  coefficients: readonly number[],
): number {
  return exactSum(binomialMasses(events, total, total, probability, coefficients));
}

function* binomialMasses(
  from: number,
  through: number,
  total: number,
  probability: number,
  coefficients: readonly number[],
): Generator<number> {
  for (let events = from; events <= through; events += 1) {
    yield (coefficients[events] ?? 0) * probability ** events * (1 - probability) ** (total - events);
  }
}

/** `math.comb(total, k)` for every `k`, exact in `BigInt` before it is rounded. */
function binomialCoefficients(total: number): number[] {
  const coefficients: number[] = [1];
  let exact = 1n;
  for (let events = 1; events <= total; events += 1) {
    exact = (exact * BigInt(total - events + 1)) / BigInt(events);
    coefficients.push(Number(exact));
  }
  return coefficients;
}
