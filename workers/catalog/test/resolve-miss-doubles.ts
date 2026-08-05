import type { ResolveDb } from "../src/api/resolve";
import type { FetchLike } from "../src/ingest/sources";

export const MISS_DB: ResolveDb = {
  worksForAlias: () => Promise.resolve([]),
  candidatesForWorks: () => Promise.reject(new Error("catalog candidates must not load on MISS")),
};

export function response(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

export function subject(id: number, name: string, name_cn?: string): Record<string, unknown> {
  return { id, name, name_cn };
}
