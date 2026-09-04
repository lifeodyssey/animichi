import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PythonRandom } from '../src/gate/python-random.ts';
import { readStatsOracle } from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle().random_stream;
const LETTERS = ['a', 'b', 'c', 'd', 'e'];

function drawn(count: number, read: (random: PythonRandom) => string | number): (string | number)[] {
  const random = new PythonRandom(oracle.seed);
  return Array.from({ length: count }, () => read(random));
}

void test('the seeded 32-bit stream is CPython\'s', () => {
  const bits = drawn(oracle.getrandbits_32.length, (random) => random.getrandbits(32));
  assert.deepEqual(bits, [...oracle.getrandbits_32]);
});

void test('choice over five values matches, rejection loop included', () => {
  const picks = drawn(oracle.choice_of_five.length, (random) => random.choice(LETTERS));
  assert.deepEqual(picks, [...oracle.choice_of_five]);
});

void test('choice over two values matches', () => {
  const picks = drawn(oracle.choice_of_two.length, (random) => random.choice(['a', 'b']));
  assert.deepEqual(picks, [...oracle.choice_of_two]);
});

void test('choice over one value still consumes the stream', () => {
  const picks = drawn(oracle.choice_of_one.length, (random) => random.choice(['a']));
  assert.deepEqual(picks, [...oracle.choice_of_one]);
});

void test('the same seed replays the same stream', () => {
  const first = drawn(8, (random) => random.getrandbits(17));
  const second = drawn(8, (random) => random.getrandbits(17));
  assert.deepEqual(first, second);
});

void test('a different seed does not', () => {
  const other = new PythonRandom(310);
  assert.notEqual(other.getrandbits(32), oracle.getrandbits_32[0]);
});

void test('an empty sequence has nothing to choose', () => {
  const random = new PythonRandom(oracle.seed);
  assert.throws(() => random.choice([]), /empty sequence/);
});

void test('getrandbits refuses a width the port never ported', () => {
  const random = new PythonRandom(oracle.seed);
  assert.throws(() => random.getrandbits(33), RangeError);
});
