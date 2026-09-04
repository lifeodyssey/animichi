import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  declaredPins,
  installedLogfireVersion,
  installedPydanticEvalsVersion,
} from '../src/pins.ts';

void test('the installed logfire version is the declared one', () => {
  assert.equal(installedLogfireVersion(), declaredPins().logfire);
});

void test('the resolved pydantic-evals version is the declared one', () => {
  assert.equal(installedPydanticEvalsVersion(), declaredPins()['pydantic-evals']);
});

void test('logfire is pinned exactly, never as a range', () => {
  assert.match(installedLogfireVersion(), /^\d+\.\d+\.\d+$/);
});
