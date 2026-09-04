/**
 * The two ways CPython adds floats, both of which the port depends on.
 *
 * `math.fsum` — Shewchuk's exact summation.
 *
 * The binomial tails sum hundreds of terms that span many orders of magnitude,
 * and `stats.py` sums them with `math.fsum`. A naive `+=` loop drifts in the
 * last bits, which is enough to flip one step of the 60-step bisection that
 * inverts the tail, so the exact algorithm is ported rather than approximated.
 */
export function exactSum(values: Iterable<number>): number {
  const partials: number[] = [];
  for (const value of values) {
    absorb(partials, value);
  }
  return collapse(partials);
}

/** One term at a time: keep every non-representable remainder as a partial. */
function absorb(partials: number[], value: number): void {
  let carried = value;
  let kept = 0;
  for (const partial of partials) {
    const [high, low] = split(carried, partial);
    if (low !== 0) {
      partials[kept] = low;
      kept += 1;
    }
    carried = high;
  }
  partials.length = kept;
  if (carried !== 0) {
    partials.push(carried);
  }
}

/** The exact two-double decomposition of `left + right`. */
function split(left: number, right: number): [number, number] {
  const [large, small] = Math.abs(left) < Math.abs(right) ? [right, left] : [left, right];
  const high = large + small;
  return [high, small - (high - large)];
}

/** Sum the partials from the top, half-even across the last two. */
function collapse(partials: number[]): number {
  let index = partials.length;
  if (index === 0) {
    return 0;
  }
  index -= 1;
  let high = partials[index] ?? 0;
  let low = 0;
  while (index > 0) {
    index -= 1;
    [high, low] = split(high, partials[index] ?? 0);
    if (low !== 0) {
      break;
    }
  }
  return index > 0 ? roundHalfEven(high, low, partials[index - 1] ?? 0) : high;
}

function roundHalfEven(high: number, low: number, next: number): number {
  if (!sameSign(low, next)) {
    return high;
  }
  const doubled = low * 2;
  const raised = high + doubled;
  return doubled === raised - high ? raised : high;
}

function sameSign(low: number, next: number): boolean {
  return (low < 0 && next < 0) || (low > 0 && next > 0);
}

/**
 * The builtin `sum()` over floats, as the interpreter this project ships on
 * computes it: plain left-to-right accumulation from `0.0`.
 *
 * This one is **version-sensitive**, which is the whole reason it is written
 * out rather than inlined as `+=` somewhere. CPython 3.12 (gh-100425) gave
 * `sum()` Neumaier's correction term, so `sum(i / 20 for i in range(20))` is
 * `9.499999999999998` on 3.11 and `9.5` on 3.12+ — a difference that reaches
 * the fourth decimal of a printed failure message and thus the gate's output.
 *
 * `apps/agent` ships on `python:3.11.13-slim` and CI pins `uv python install
 * 3.11`, so 3.11 is the behaviour the port owes parity to. The oracle is
 * generated under that same pin (`stats_oracle.py` refuses to run otherwise),
 * so moving the agent to 3.12+ turns the fixture drift gate red here and this
 * function is what has to change with it.
 */
export function pythonSum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}
