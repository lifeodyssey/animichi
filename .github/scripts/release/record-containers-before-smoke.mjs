import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readContainerApplications } from '../../lib/release/container-applications.mjs';

// #1596 AC5 asks for the smoke to pass with the container application stopped,
// and the smoke runs BEFORE the evidence recorder: a read taken afterwards says
// nothing about the state the smoke passed in. cd.yml runs this immediately
// before the smoke, and record-evidence.mjs carries the file into the
// transcript, where the verifier holds the criterion to both reads (#1713).
assert.equal(process.argv[2], 'staging', 'the deploy-evidence catalog observes staging; production needs no recorder');
const read = { observed_at: new Date().toISOString(), container_applications: readContainerApplications() };
writeFileSync('containers-before-smoke.json', `${JSON.stringify(read, null, 2)}\n`);
