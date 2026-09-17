import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { unstable_readConfig } from 'wrangler';
import { deploymentIdentity, containerIdentity, awaitContainerImage, containerWaitBudgetMs } from '../../lib/release/observations.mjs';

// #1683: every staging CD failed because `containers info` was read once, before
// the application's asynchronous rollout reported the selected image. The knobs
// live in cd.yml's step env (CONTAINER_ATTEMPTS / CONTAINER_RETRY_DELAY /
// CONTAINER_READ_TIMEOUT, in seconds); these defaults only cover a manual run.
// The first read is immediate, so the wait budget is (12 - 1) x 15s = 165s, and
// it is that size on purpose: run 35045881568 still read the previous digest 24s
// after the modify returned, and one container rollout step plus its health gate
// can take minutes.
const CONTAINER_WAIT_ATTEMPTS = Number(process.env.CONTAINER_ATTEMPTS ?? 12);
const CONTAINER_WAIT_DELAY_MS = Number(process.env.CONTAINER_RETRY_DELAY ?? 15) * 1000;
// #1683 review: `wrangler containers info` (Wrangler 4.114.0) documents no
// request timeout — its containers client builds an AbortController for caller
// cancellation only and never arms it — so a hung read would otherwise stall
// this step until the 120-minute job timeout with no diagnostic. Each read is
// capped below the wait budget, and the poll counts a killed read as one failed
// attempt that the next attempt re-reads.
const CONTAINER_READ_TIMEOUT_MS = Number(process.env.CONTAINER_READ_TIMEOUT ?? 30) * 1000;
const CONTAINER_WAIT_BUDGET_MS = containerWaitBudgetMs(CONTAINER_WAIT_ATTEMPTS, CONTAINER_WAIT_DELAY_MS);
assert.ok(CONTAINER_READ_TIMEOUT_MS < CONTAINER_WAIT_BUDGET_MS,
  `CONTAINER_READ_TIMEOUT (${CONTAINER_READ_TIMEOUT_MS}ms) must stay below the container wait budget ((CONTAINER_ATTEMPTS - 1) x CONTAINER_RETRY_DELAY = ${CONTAINER_WAIT_BUDGET_MS}ms)`);

const WRANGLER_EXEC = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };

function wrangler(...args) {
  return executeWrangler({}, ...args);
}

// The poll's read, and only the poll's read: a killed call is caught by the wait
// and retried, while every other wrangler call in this receipt is single-shot.
function containersInfo(id) {
  try {
    return executeWrangler({ timeout: CONTAINER_READ_TIMEOUT_MS }, 'containers', 'info', id);
  } catch (error) {
    const detail = error?.code === 'ETIMEDOUT' ? `did not answer within ${CONTAINER_READ_TIMEOUT_MS}ms` : error.message;
    throw new Error(`containers info ${id} ${detail}`, { cause: error });
  }
}

function executeWrangler(exec, ...args) {
  return JSON.parse(execFileSync('pnpm', ['exec', 'wrangler', ...args], { ...WRANGLER_EXEC, ...exec }));
}

function observeContainers(config, version, applications, image) {
  const containers = config.containers ?? [];
  // #1606: the snapshot names an image only for a unit that still declares a container, so
  // a live container it does not name has no identity to be observed against. Refuse it here
  // rather than poll `undefined` for every attempt and report a convergence failure.
  assert.ok(containers.length === 0 || image, `${config.name} declares a container the selected snapshot names no image for`);
  return containers.map((container) => {
    const listed = applications.find((application) => application.name === container.name);
    assert.ok(listed, 'deployed container application is unavailable');
    const read = () => containersInfo(listed.id);
    const application = awaitContainerImage(read, image, { attempts: CONTAINER_WAIT_ATTEMPTS, delayMs: CONTAINER_WAIT_DELAY_MS });
    return containerIdentity(application, version, container, image, config.name);
  });
}

function observeWorker(unit, environment, manifest, applications) {
  const config = unstable_readConfig({ config: `release/${unit}/wrangler.json`, env: environment });
  const deployments = wrangler('deployments', 'list', '--name', config.name, '--json');
  const deployment = deployments.sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
  assert.ok(deployment?.versions?.length === 1, 'missing complete Worker deployment');
  const version = wrangler('versions', 'view', deployment.versions[0].version_id, '--name', config.name, '--json');
  const identity = deploymentIdentity(deployment, version, manifest.source_sha);
  const containers = observeContainers(config, version, applications, manifest.images[unit]);
  return { unit, script_name: config.name, ...identity, containers };
}

const environment = process.argv[2];
assert.ok(['staging', 'production'].includes(environment), 'unknown receipt environment');
const manifest = JSON.parse(readFileSync('release/release.json', 'utf8'));
const schema = JSON.parse(readFileSync('schema-preflight.json', 'utf8'));
assert.equal(schema.compatible, true);
const prismaRef = JSON.parse(readFileSync('release/migrator/bundle/contract.json', 'utf8')).storage.storageHash;
assert.match(prismaRef, /^[a-f0-9]{64}$/);
assert.equal(schema.prisma.targetHash, prismaRef);
assert.equal(schema.prisma.markerHash, prismaRef);
assert.equal(schema.prisma.usedLiveMarker, true);
assert.deepEqual(schema.prisma.migrations, []);
const applications = wrangler('containers', 'list', '--json');
const workers = ['migrator', 'catalog', 'users', 'edge', 'web'].map((unit) => observeWorker(unit, environment, manifest, applications));
const selection = JSON.parse(readFileSync('selection.json', 'utf8'));
const receipt = { format: 1, environment, selection, controller_run_id: process.env.GITHUB_RUN_ID, controller_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
  workers, schema, images: manifest.images, smoke: 'passed', observed_at: new Date().toISOString() };
writeFileSync('receipt.json', JSON.stringify(receipt, null, 2));
