export const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

export function envWithCatalog(captured: { req?: Request }) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    CATALOG: { fetch: (r: Request) => { captured.req = r; return Promise.resolve(new Response("cat")); } },
  } as never;
}

/** An EDGE_GUARD stand-in that always allows — these tests exercise routing
 * and header handling, not the limiter itself (see byok.test.ts / Task 9). */
export const alwaysAllowGuard = {
  idFromName: (name: string) => name as unknown as DurableObjectId,
  get: () => ({
    fetch: () =>
      Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
  }),
};

export function envWithContainer(captured: { req?: Request }) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: (r: Request) => { captured.req = r; return Promise.resolve(new Response("container")); } }),
    },
  } as never;
}
