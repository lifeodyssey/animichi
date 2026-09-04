/**
 * CPython's `random.Random`, ported so the bootstrap draws the same resamples.
 *
 * `stats.py` seeds `random.Random(309)` and calls `rng.choice(values)` once per
 * resampled score. Any other generator would produce a different — still
 * "correct" — confidence interval, and the TS gate could not be diffed against
 * the Python one. So this is the real thing: MT19937 seeded through
 * `init_by_array`, `getrandbits(k)` as the top `k` bits of a 32-bit draw, and
 * `choice` through the rejection loop in `Random._randbelow_with_getrandbits`.
 *
 * Seeding and the twist are one-shot algorithms over the state array and live
 * outside the class; the class is the drawing state machine.
 *
 * Pinned against `fixtures/stats-oracle.json` (`random_stream`).
 */

const STATE_SIZE = 624;
const MIDDLE_WORD = 397;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
/** `mag01` in `_randommodule.c`: XOR the twist constant on odd words only. */
const TWIST = [0x00000000, 0x9908b0df];
const INIT_SEED = 19650218;

export class PythonRandom {
  readonly #state: Uint32Array;
  #index = STATE_SIZE;

  constructor(seed: number) {
    this.#state = seededState(seed);
  }

  /** `random.Random.choice` — `seq[self._randbelow(len(seq))]`. */
  choice<Value>(values: readonly Value[]): Value {
    if (values.length === 0) {
      throw new RangeError('Cannot choose from an empty sequence');
    }
    return values[this.#randBelow(values.length)] as Value;
  }

  /** `random.Random.getrandbits`, for the `k <= 32` the port ever asks for. */
  getrandbits(bits: number): number {
    if (bits < 0 || bits > 32) {
      throw new RangeError(`getrandbits(${String(bits)}) is outside the ported range`);
    }
    return bits === 0 ? 0 : this.#nextWord() >>> (32 - bits);
  }

  /** `Random._randbelow_with_getrandbits`: draw `k` bits until one fits. */
  #randBelow(bound: number): number {
    const bits = 32 - Math.clz32(bound);
    let drawn = this.getrandbits(bits);
    while (drawn >= bound) {
      drawn = this.getrandbits(bits);
    }
    return drawn;
  }

  #nextWord(): number {
    if (this.#index >= STATE_SIZE) {
      twistState(this.#state);
      this.#index = 0;
    }
    return temper(wordAt(this.#state, this.#index++));
  }
}

/** `init_by_array` over the state `init_genrand(19650218)` leaves behind. */
function seededState(seed: number): Uint32Array {
  const state = initialState(INIT_SEED);
  const key = seedKey(seed);
  let position = stirKey(state, key);
  for (let remaining = STATE_SIZE - 1; remaining > 0; remaining -= 1) {
    const previous = wordAt(state, position - 1);
    state[position] =
      (wordAt(state, position) ^ Math.imul(1566083941, previous ^ (previous >>> 30))) - position;
    position = wrap(state, position + 1);
  }
  state[0] = UPPER_MASK;
  return state;
}

/** `init_genrand`, the fixed starting state `init_by_array` stirs the key into. */
function initialState(seed: number): Uint32Array {
  const state = new Uint32Array(STATE_SIZE);
  state[0] = seed;
  for (let position = 1; position < STATE_SIZE; position += 1) {
    const previous = wordAt(state, position - 1);
    state[position] = Math.imul(1812433253, previous ^ (previous >>> 30)) + position;
  }
  return state;
}

function stirKey(state: Uint32Array, key: readonly number[]): number {
  let position = 1;
  let keyIndex = 0;
  for (let remaining = Math.max(STATE_SIZE, key.length); remaining > 0; remaining -= 1) {
    const previous = wordAt(state, position - 1);
    state[position] =
      (wordAt(state, position) ^ Math.imul(1664525, previous ^ (previous >>> 30))) +
      (key[keyIndex] ?? 0) +
      keyIndex;
    position = wrap(state, position + 1);
    keyIndex = (keyIndex + 1) % key.length;
  }
  return position;
}

function twistState(state: Uint32Array): void {
  for (let position = 0; position < STATE_SIZE; position += 1) {
    const joined =
      (wordAt(state, position) & UPPER_MASK) |
      (wordAt(state, (position + 1) % STATE_SIZE) & LOWER_MASK);
    const mixed = wordAt(state, (position + MIDDLE_WORD) % STATE_SIZE) ^ (joined >>> 1);
    state[position] = mixed ^ (TWIST[joined & 1] ?? 0);
  }
}

/** `if (i >= N) { mt[0] = mt[N - 1]; i = 1; }` */
function wrap(state: Uint32Array, position: number): number {
  if (position < STATE_SIZE) {
    return position;
  }
  state[0] = wordAt(state, STATE_SIZE - 1);
  return 1;
}

function wordAt(state: Uint32Array, position: number): number {
  return state[position] ?? 0;
}

/** `random_seed`: an int seed becomes its absolute value in 32-bit words. */
function seedKey(seed: number): number[] {
  let remaining = Math.abs(Math.trunc(seed));
  const key: number[] = [];
  do {
    key.push(remaining % 0x100000000);
    remaining = Math.floor(remaining / 0x100000000);
  } while (remaining > 0);
  return key;
}

function temper(word: number): number {
  let tempered = word ^ (word >>> 11);
  tempered ^= (tempered << 7) & 0x9d2c5680;
  tempered ^= (tempered << 15) & 0xefc60000;
  return (tempered ^ (tempered >>> 18)) >>> 0;
}
