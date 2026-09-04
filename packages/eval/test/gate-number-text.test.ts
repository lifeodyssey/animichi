import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  pythonFixedText,
  pythonFloatText,
  pythonPercentText,
} from '../src/gate/python-number-text.ts';
import { readStatsOracle } from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle().number_text;

for (const entry of oracle.fixed_4) {
  void test(`format(${String(entry.value)}, '.4f') is ${entry.text}`, () => {
    assert.equal(pythonFixedText(entry.value, 4), entry.text);
  });
}

for (const entry of oracle.percent_0) {
  void test(`format(${String(entry.value)}, '.0%') is ${entry.text}`, () => {
    assert.equal(pythonPercentText(entry.value), entry.text);
  });
}

for (const entry of oracle.repr) {
  void test(`repr(${entry.text}) round trips`, () => {
    assert.equal(pythonFloatText(entry.value), entry.text);
  });
}

void test('a decimal tie rounds to even, the way Python does and toFixed does not', () => {
  assert.equal(pythonFixedText(0.15625, 4), '0.1562');
  assert.notEqual((0.15625).toFixed(4), '0.1562');
});

void test('an integral float keeps its trailing zero', () => {
  assert.equal(pythonFloatText(1), '1.0');
  assert.equal(pythonFloatText(-0), '-0.0');
});
