/** Typed boundary for the Node globals that `@cloudflare/workers-types` widens.
 *
 * This package type-checks its Worker surface and its Node-side test surfaces in
 * one program whose `types` lists both `@cloudflare/workers-types` and `node`.
 * Since 5.20260916.1 that package ships a `nodejs_compat` global block in
 * `index.d.ts` — `declare const process: any; declare const Buffer: any;` —
 * which wins over `@types/node` for the bare `process` and `Buffer` identifiers,
 * so every use in a Node-side file becomes an unsafe `any` under
 * `oxlint --type-aware --deny-warnings`. Importing `node:process` or
 * `node:buffer` directly does not escape the widening: their declarations
 * re-export the widened global. Node-side files therefore reach the runtime
 * objects through this module; the values are captured as `unknown` and their
 * Node types are restored at exactly this one place. Both exports are the real
 * runtime bindings (`globalThis.process` and `node:buffer`'s `Buffer`), so
 * shadowing the bare identifiers with these imports changes no behavior.
 */
import processWidened from "node:process";
import { Buffer as bufferWidened } from "node:buffer";

const restoredProcess: unknown = processWidened;
const restoredBuffer: unknown = bufferWidened;

export const process = restoredProcess as NodeJS.Process;
export const Buffer = restoredBuffer as BufferConstructor;
