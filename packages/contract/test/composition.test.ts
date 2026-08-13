/**
 * Contract composition vs emitted OpenAPI (issue #1005 AC2).
 *
 * The committed OpenAPI documents must be emitted from the complete service
 * contract/router surface — never a hand-assembled partial sub-contract. If
 * the emitter ever regressed to composing a subset (or a spread of
 * sub-contracts, as the retired check-in/share composition did), the emitted
 * operation set would diverge from the contract's own procedures and this
 * test fails.
 *
 * Runtime parity (the other half of the truth) lives in
 * workers/users/test/operation-parity.worker.test.ts and the agent FastAPI
 * parity test.
 */

import { describe, expect, it } from "vitest";
import { AGENT_PATHS } from "../src/agent-contract.js";
import { catalogContract } from "../src/contract.js";
import {
  operationKey,
  operationsFromContractRouter,
  operationsFromOpenApi,
  sortOperations,
  type ApiDocument,
  type ApiOperation,
} from "../src/operation-set.js";
import { usersContract } from "../src/users-contract.js";
import agentOpenApi from "../agent-openapi.json";
import catalogOpenApi from "../openapi.json";
import usersOpenApi from "../users-openapi.json";

function keysOf(operations: readonly ApiOperation[]): string[] {
  return sortOperations(operations).map(operationKey);
}

function asDocument(value: unknown): ApiDocument {
  if (typeof value !== "object" || value === null) {
    throw new Error("expected an OpenAPI document object");
  }
  const paths = (value as Record<string, unknown>)["paths"];
  if (typeof paths !== "object" || paths === null) {
    throw new Error("OpenAPI document must declare an object paths field");
  }
  return value as ApiDocument;
}

describe("emitted OpenAPI equals the complete service contract", () => {
  it("users-openapi.json is the complete Users service contract", () => {
    expect(keysOf(operationsFromOpenApi(asDocument(usersOpenApi)))).toEqual(
      keysOf(operationsFromContractRouter(usersContract)),
    );
  });

  it("openapi.json is the complete Catalog service contract", () => {
    expect(keysOf(operationsFromOpenApi(asDocument(catalogOpenApi)))).toEqual(
      keysOf(operationsFromContractRouter(catalogContract)),
    );
  });

  it("agent-openapi.json is the complete Agent path inventory", () => {
    expect(keysOf(operationsFromOpenApi(asDocument(agentOpenApi)))).toEqual(
      keysOf(AGENT_PATHS.map((entry) => ({ method: entry.method, path: entry.path }))),
    );
  });
});
