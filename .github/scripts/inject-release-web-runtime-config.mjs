import { readFileSync, writeFileSync } from "node:fs";
import { applyEdits, format, modify } from "jsonc-parser";
import { buildRuntimePayload } from "./release-web-runtime-config.mjs";

const configPath = process.env.WEB_CONFIG_PATH ?? "";
const target = process.env.TARGET_ENVIRONMENT ?? "";
if (!configPath || !["staging", "production"].includes(target)) process.exit(2);

const payload = buildRuntimePayload(process.env);
const source = readFileSync(configPath, "utf8");
const edits = modify(source, ["env", target, "vars", "RUNTIME_CONFIG"], JSON.stringify(payload), {});
const edited = applyEdits(source, edits);
writeFileSync(configPath, applyEdits(edited, format(edited, undefined, { tabSize: 2, insertSpaces: true })));
console.log(`injected public runtime config for ${target}`);
