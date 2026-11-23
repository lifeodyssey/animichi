import { operationsFromContractRouter, usersContract } from "@animichi/contract";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";

/**
 * The `Allow` header of the users prefix, read off the users contract rather
 * than listed here, so a procedure the contract gains is advertised with it.
 * It names each method of a procedure routed under `/v1/users/`, once and in
 * declaration order; the HEAD a GET route also answers (`router.ts`), beside
 * its GET; and the OPTIONS the gateway answers itself (`route-services.ts`).
 */

function declaredMethods(): string[] {
  const routed = operationsFromContractRouter(usersContract).filter((operation) => operation.path.startsWith(USERS_BINDING_PREFIX));
  return [...new Set(routed.map((operation) => operation.method))];
}

function allowOf(methods: readonly string[]): string {
  return [...methods.flatMap((method) => (method === "GET" ? [method, "HEAD"] : [method])), "OPTIONS"].join(", ");
}

export const USERS_ALLOW: string = allowOf(declaredMethods());
