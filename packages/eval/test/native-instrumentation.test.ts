import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

void test('the documented preload configures native Logfire and reports an unconfigured uploader', async () => {
  const environment = { ...process.env };
  delete environment.LOGFIRE_TOKEN;
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--import', './scripts/instrument-evals.ts', '--input-type=module', '--eval',
      "import {logfireConfig,shutdown} from '@pydantic/logfire-node'; console.log(JSON.stringify({service:logfireConfig.serviceName,send:logfireConfig.sendToLogfire,sampling:logfireConfig.sampling})); await shutdown();"],
    { cwd: new URL('..', import.meta.url), env: environment });
  assert.deepEqual(JSON.parse(stdout), { service: 'animichi-eval', send: false, sampling: { head: 1 } });
  assert.match(stderr, /Logfire uploader unconfigured/);
});
