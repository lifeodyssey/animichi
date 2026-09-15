import assert from 'node:assert/strict';
import { test } from 'node:test';

import { declaredPins, installedLogfireVersion } from '../src/pins.ts';

void test('the installed logfire version is the declared one', () => {
  assert.equal(installedLogfireVersion(), declaredPins().logfire);
});

void test('the frozen pydantic-evals version is declared exactly, never a range', () => {
  assert.match(declaredPins()['pydantic-evals'], /^\d+\.\d+\.\d+$/);
});

void test('logfire is pinned exactly, never as a range', () => {
  assert.match(installedLogfireVersion(), /^\d+\.\d+\.\d+$/);
});
