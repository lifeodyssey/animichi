/**
 * Users OpenAPI/runtime operation parity (issue #1005 AC1).
 *
 * The generated Users OpenAPI document (emitted from the contract) must equal
 * the operation set the mounted runtime router actually serves. The runtime
 * set is derived from the router's mounted procedures via the contract — a
 * procedure that exists in the emitted document but is absent from the router
 * (a phantom, like the retired check-in/share surfaces) fails here.
 */

import { describe, expect, it } from "vitest";
import {
  contractSubset,
  operationKey,
  operationsFromContractRouter,
  operationsFromOpenApi,
  sortOperations,
  type ApiDocument,
} from "@animichi/contract";
import { usersContract } from "@animichi/contract";
import usersOpenApiJson from "../../../packages/contract/users-openapi.json";
import { usersRouter } from "../src/router";

const usersOpenApi = usersOpenApiJson as unknown as ApiDocument;

describe("Users OpenAPI/runtime operation parity", () => {
  it("the generated Users OpenAPI equals the mounted runtime router operations", () => {
    const generated = sortOperations(operationsFromOpenApi(usersOpenApi)).map(operationKey);
    const mounted = sortOperations(
      operationsFromContractRouter(contractSubset(usersContract, Object.keys(usersRouter))),
    ).map(operationKey);
    expect(generated).toEqual(mounted);
  });

  it("the mounted router implements exactly the Users service contract procedures", () => {
    expect(Object.keys(usersRouter).sort()).toEqual(Object.keys(usersContract).sort());
  });
});
