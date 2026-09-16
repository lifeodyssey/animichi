import assert from 'node:assert/strict';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function deploymentIdentity(deployment, version, source) {
  assert.match(deployment.id, UUID, 'missing actual deployment ID');
  assert.match(version.id, UUID, 'missing actual version ID');
  assert.deepEqual(deployment.versions, [{ version_id: version.id, percentage: 100 }], 'release must serve all traffic');
  assert.equal(version.annotations?.['workers/tag'], `sha-${source}`, 'live Worker is not the selected source');
  return { deployment_id: deployment.id, version_id: version.id };
}

export function containerIdentity(application, version, container, image, scriptName) {
  const binding = version.resources.bindings.find((item) => item.type === 'durable_object_namespace' && item.class_name === container.class_name && (!item.script_name || item.script_name === scriptName));
  assert.match(application.id, UUID, 'missing actual container application ID');
  assert.equal(application.name, container.name, 'container application name mismatch');
  assert.equal(application.configuration.image, image, 'live container image differs from the selected digest');
  assert.ok(binding?.namespace_id, 'container has no script-scoped Durable Object');
  assert.equal(application.durable_objects.namespace_id, binding.namespace_id, 'container belongs to another Worker');
  return { application_id: application.id, name: application.name, image, namespace_id: binding.namespace_id };
}

// #1683: `wrangler containers info` returns the application the scheduler is
// currently serving, and an image change creates an asynchronous rollout, so the
// reads right after a publish still report the previous `configuration.image`.
// No field of that payload states the intended image — `active_rollout_id` is an
// id, and the rollout it names (`target_configuration.image`) lives on an
// endpoint Wrangler 4.114.0 does not expose — so the receipt polls the
// application until it reports the digest it is about to record. `options.sleep`
// and `read` are injected so the wait is testable without wall time.
export function awaitContainerImage(read, image, options) {
  const { attempts, delayMs, sleep = pause } = options;
  assert.ok(Number.isInteger(attempts) && attempts > 0 && Number.isInteger(delayMs) && delayMs > 0, 'container wait needs positive integer attempts and delayMs');
  let application = read();
  for (let attempt = 1; application?.configuration?.image !== image; attempt += 1) {
    assert.ok(attempt < attempts, convergenceFailure(application, image, attempts, delayMs));
    sleep(delayMs);
    application = read();
  }
  return application;
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function convergenceFailure(application, image, attempts, delayMs) {
  const observed = application?.configuration?.image ?? 'none';
  const rollout = application?.active_rollout_id ?? 'none';
  return `container image did not converge after ${attempts} attempts (${(attempts * delayMs) / 1000}s budget): ` +
    `expected ${image}, last observed ${observed}, active rollout ${rollout}`;
}
