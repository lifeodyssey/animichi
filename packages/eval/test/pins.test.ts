import assert from 'node:assert/strict';
import { test } from 'node:test';

import { declaredPins, installedPiAgentVersion, installedLogfireVersion, logfireRuntimeInstalls } from '../src/pins.ts';

void test('the installed logfire version is the declared one', () => {
  assert.equal(installedLogfireVersion(), declaredPins().logfire);
});

void test('the frozen pydantic-evals version is declared exactly, never a range', () => {
  assert.match(declaredPins()['pydantic-evals'], /^\d+\.\d+\.\d+$/);
});

void test('logfire is pinned exactly, never as a range', () => {
  assert.match(installedLogfireVersion(), /^\d+\.\d+\.\d+$/);
});

void test('the Pi SDK version a recorded prefix names is the pinned exact one', () => {
  assert.match(installedPiAgentVersion(), /^\d+\.\d+\.\d+$/);
});

// The node SDK names its `logfire` exactly, so a bump of `@pydantic/logfire-node` to a
// release that names a different logfire installs a second runtime; the pin is one copy,
// and this is the gate that goes red when the pin stops being one (#1746).
void test('the eval package and the node SDK resolve one logfire runtime', () => {
  const installs = logfireRuntimeInstalls();
  assert.equal(installs.evalInstall, installs.nodeSdkInstall);
});
