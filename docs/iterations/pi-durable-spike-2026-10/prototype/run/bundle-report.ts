/**
 * Question 1's bundle criterion, read from the artifact the official Wrangler dry-run emits for `src/q1.worker.ts`
 * (the same artifact `q1.ts` executes): every runtime import left external and who imports it, the unenv polyfills
 * Wrangler bundled in their place, dynamic imports, extra emitted modules, the packages pi-durable 1.5.2 newly depends
 * on, and where the text `new Function` occurs. Writes `../evidence/q1-bundle.json`.
 */
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { bundle } from "./bundle.ts";
import { writeEvidence } from "./workerd.ts";

const SUSPECTS = ["@earendil-works/pi-codemode", "quickjs-wasi", "@silvia-odwyer/photon", "typebox", "@sinclair/typebox", "openai",
  "@anthropic-ai/sdk", "@google/genai", "@aws-sdk/client-bedrock-runtime", "@smithy/node-http-handler", "http-proxy-agent", "https-proxy-agent"];

/** `node_modules/.pnpm/<name>@<version>/node_modules/<name>/dist/x.js` becomes `<name>@<version> dist/x.js`. */
function label(path: string): { readonly pkg: string; readonly file: string } {
  const at = path.lastIndexOf("node_modules/");
  if (at === -1) return { pkg: "(prototype or wrangler)", file: path.replace(/^.*\/(src|templates)\//, "$1/") };
  const rest = path.slice(at + "node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0] ?? "";
  const version = /\.pnpm\/([^/]+)\//.exec(path)?.[1]?.split("_")[0]?.replace(/^.*@(?=[\d])/, "") ?? "";
  return { pkg: version ? `${name}@${version}` : name, file: rest.slice(name.startsWith("@") ? 2 : 1).join("/") };
}

const work = mkdtempSync(join(tmpdir(), "pi-durable-spike-bundle-"));
const built = await bundle("src/q1.worker.ts", work);
const inputs = Object.entries(built.metafile.inputs);
const external = new Map<string, Set<string>>();
const dynamic: { importer: string; path: string }[] = [];
/** Wrangler routes a `node:` import through a `node-built-in-modules:` shim; credit the module that asked for it. */
const SHIM = "node-built-in-modules:";
for (const [path, input] of inputs) {
  if (path.startsWith(SHIM)) continue;
  for (const entry of input.imports) {
    const importer = `${label(path).pkg} ${label(path).file}`;
    if (entry.kind === "dynamic-import") dynamic.push({ importer, path: entry.original ?? entry.path });
    const specifier = entry.path.startsWith(SHIM) ? entry.path.slice(SHIM.length) : entry.path;
    // `<runtime>` is esbuild's own helper module inside the bundle, not an import the runtime resolves.
    if ((entry.external || entry.path.startsWith(SHIM)) && specifier !== "<runtime>") external.set(specifier, (external.get(specifier) ?? new Set()).add(importer));
  }
}
const packages = [...new Set(inputs.map(([path]) => label(path).pkg))].sort();
const newFunction = [...built.code.matchAll(/new Function\s*\(/g)].map((match) => {
  const before = built.code.lastIndexOf("\n// ", match.index);
  const module = built.code.slice(before + 4, built.code.indexOf("\n", before + 4)).replace(/^.*\/prototype\//, "prototype/").replace(/^.*node_modules\//, "");
  return { offset: match.index, module, context: built.code.slice(Math.max(0, match.index - 120), match.index + 60) };
});
const report = {
  runtime: built.runtime,
  bytes: Buffer.byteLength(built.code), gzipBytes: gzipSync(built.code).byteLength,
  emittedFiles: readdirSync(work).filter((file) => !file.endsWith(".json") && !file.endsWith(".log")),
  externalImports: Object.fromEntries([...external].map(([specifier, importers]) => [specifier, [...importers].sort()])),
  unenvPolyfills: inputs.map(([path]) => path).filter((path) => /unenv/.test(path)).map((path) => `${label(path).pkg} ${label(path).file}`),
  dynamicImports: dynamic,
  suspectsInGraph: Object.fromEntries(SUSPECTS.map((name) => [name, packages.filter((pkg) => pkg.startsWith(`${name}@`) || pkg === name)])),
  packages,
  newFunctionOccurrences: newFunction,
};
writeEvidence("q1-bundle.json", report);
console.log(JSON.stringify({ bytes: report.bytes, gzipBytes: report.gzipBytes, emittedFiles: report.emittedFiles, externalImports: Object.keys(report.externalImports),
  unenvPolyfills: report.unenvPolyfills.length, dynamicImports: dynamic.length, suspects: report.suspectsInGraph,
  newFunction: newFunction.map((item) => item.module) }, null, 1));
