"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_VERSION = "1.4.200";

function clientPath(argv) {
  const index = argv.indexOf("--client");
  if (index < 0 || !argv[index + 1]) throw new Error("missing --client");
  return path.resolve(argv[index + 1]);
}

function packageVersion(file) {
  const packageFile = path.resolve(path.dirname(file), "..", "..", "package.json");
  return JSON.parse(fs.readFileSync(packageFile, "utf8")).version;
}

async function compatibility(file) {
  const installedVersion = packageVersion(file);
  if (installedVersion !== EXPECTED_VERSION) throw new Error("unsupported_orca_version");
  const { RuntimeClient } = require(file);
  const status = await new RuntimeClient().call("status.get");
  if (status.result.appVersion !== EXPECTED_VERSION) throw new Error("unsupported_orca_version");
  return { ok: true, result: { expectedVersion: EXPECTED_VERSION, installedVersion, status } };
}

function requestPath(argv) {
  const index = argv.indexOf("--request");
  if (index < 0 || !argv[index + 1]) throw new Error("missing_request");
  return path.resolve(argv[index + 1]);
}

async function terminalCreate(file, argv) {
  await compatibility(file);
  const request = JSON.parse(fs.readFileSync(requestPath(argv), "utf8"));
  const { RuntimeClient } = require(file);
  const client = new RuntimeClient();
  return client.call("terminal.create", request.params, { orchestrationRequestId: request.requestId });
}

async function main() {
  const operation = process.argv[2];
  const argv = process.argv.slice(3);
  const file = clientPath(argv);
  if (operation === "compatibility") return console.log(JSON.stringify(await compatibility(file)));
  if (operation === "terminal-create") return console.log(JSON.stringify(await terminalCreate(file, argv)));
  throw new Error("unsupported_operation");
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: { code: error.message } }));
  process.exitCode = 1;
});
