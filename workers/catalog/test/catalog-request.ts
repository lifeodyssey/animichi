import worker from "../src/index";
import type { Env } from "../src/index";

const CTX = {} as ExecutionContext;

export function catalogRequest(path: string, init: RequestInit = {}, env: Env = {}): Promise<Response> {
  return Promise.resolve(worker.fetch(new Request(new URL(path, "http://catalog.example"), init), env, CTX));
}
