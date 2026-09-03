/// <reference types="@cloudflare/workers-types" />

/**
 * A Durable Object namespace narrowed to the only two calls the agent tier
 * makes on one: address an instance by name, and post it a request. Declared
 * structurally (the same shape `GuardNamespace` uses for the edge guards) so
 * the intake and the sweeper stay unit-testable against a plain object with no
 * Cloudflare bindings in scope.
 */
export interface NamedStubs {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch: (request: Request) => Promise<Response> };
}
