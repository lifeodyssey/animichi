/**
 * One request through the whole edge app, with the case's own bindings.
 *
 * The app's request signature takes the deployed `Env` and the runtime's
 * `ExecutionContext`, while a case builds only the keys its seam reads and the
 * context double it needs (`stubCtx`, `collectingCtx`). Both partial shapes are
 * named here — `Partial<Env>` and `WorkerExecutionContext` — so the one bridge
 * below is the whole of the impedance, rather than a `never` at every call site.
 */
import { createWorkerApp } from "../../src/app.ts";
import { stubCtx } from "./entry-env.ts";
import type { Env, WorkerExecutionContext } from "../../src/env.ts";

export function edgeAppRequest(
  path: string, env: Partial<Env>, init: RequestInit = {}, ctx: WorkerExecutionContext = stubCtx,
): Promise<Response> {
  return Promise.resolve(createWorkerApp({}).request(path, init, env, ctx as ExecutionContext));
}
