/**
 * N / N-1 rolling-deployment compatibility for the Users service binding
 * (issue #1005 AC6).
 *
 * The Users worker is reached only through the edge's `USERS` binding. During
 * a rolling promotion the edge may run version N while a Users instance still
 * runs N-1, so the shared surface between the two consecutive contracts must
 * stay wire-compatible, and the identity/binding protocol must be
 * version-invariant.
 *
 * N-1 is frozen from a real previous artifact: the published Users OpenAPI
 * document immediately before the phantom check-in/share hard cut (AC3),
 * committed verbatim as `test/fixtures/users-contract-n-1.json` (the
 * merge-base document of this landing). It is loaded independently — never
 * derived from the current contract and never the same object as N. The three
 * rolling invariants:
 *  1. N-1 serves a superset of N's operations on the shared surface;
 *  2. every shared operation's route and wire schemas are identical;
 *  3. the edge→Users binding protocol (identity headers + prefix) is the same
 *     single shared constant in both versions.
 */

import { describe, expect, it } from "vitest";
import { diffOpenApi } from "../src/openapi-diff.js";
import {
  AUTHORIZATION_HEADER,
  USER_IDENTITY_HEADER,
  USER_TYPE_HEADER,
  USERS_BINDING_PREFIX,
} from "../src/internal-binding.js";
import {
  operationKey,
  operationsFromOpenApi,
  sortOperations,
  type ApiDocument,
  type WireOperation,
} from "../src/operation-set.js";
import { usersContract } from "../src/users-contract.js";
import currentJson from "../users-openapi.json";
import nMinusOneJson from "./fixtures/users-contract-n-1.json";

const nMinusOne = nMinusOneJson as unknown as ApiDocument;
const current = currentJson as unknown as ApiDocument;
const currentOps = sortOperations(operationsFromOpenApi(current));
const previousOps = sortOperations(operationsFromOpenApi(nMinusOne));
const currentKeys = new Set(currentOps.map(operationKey));
const previousKeys = new Set(previousOps.map(operationKey));

/** Map every operation key to its wire view, for cross-version lookups. */
function operationMap(document: ApiDocument): Map<string, WireOperation> {
  const map = new Map<string, WireOperation>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      map.set(operationKey({ method: method.toUpperCase(), path }), operation);
    }
  }
  return map;
}

/** Lowercase HTTP methods declared on a document's path item. */
function methodsOn(document: ApiDocument, path: string): string[] {
  const item = document.paths[path];
  if (item === undefined) return [];
  return Object.keys(item).map((method) => method.toLowerCase());
}

/** The request + success-response wire surface a client depends on; additive
 * optional headers and new error responses (issue #1011) are excluded because
 * they never change what N-1 clients send or receive on success. */
function clientWireShape(operation: WireOperation | undefined): unknown {
  if (operation === undefined) return undefined;
  return {
    requestBody: operation.requestBody,
    success: operation.responses["200"],
  };
}

describe("rolling N/N-1 operation set", () => {
  it("N-1 serves every operation N serves (strict superset)", () => {
    for (const operation of currentOps) {
      expect(previousKeys.has(operationKey(operation))).toBe(true);
    }
    expect(previousOps.length).toBe(currentOps.length + 5);
  });

  it("the only difference is the retired phantom check-in/share surface", () => {
    const retired = previousOps.filter((operation) => !currentKeys.has(operationKey(operation)));
    expect(retired).toEqual([
      { method: "DELETE", path: "/v1/users/shares/{share_id}" },
      { method: "GET", path: "/v1/users/checkins" },
      { method: "GET", path: "/v1/users/shares/resolve/{token}" },
      { method: "POST", path: "/v1/users/checkins" },
      { method: "POST", path: "/v1/users/shares" },
    ]);
  });

  it("N no longer mounts the retired surface (AC3 phantom hard cut)", () => {
    expect(Object.keys(current.paths).sort()).toEqual([
      "/v1/users/saved-routes",
      "/v1/users/saved-routes/{id}",
    ]);
  });

  it("every shared operation keeps its exact route in both versions", () => {
    for (const path of Object.keys(current.paths)) {
      expect(nMinusOne.paths[path]).toBeDefined();
      for (const method of methodsOn(current, path)) {
        expect(methodsOn(nMinusOne, path)).toContain(method);
      }
    }
  });

  it("N-1 is an independently loaded fixture, never the same object as N", () => {
    expect(nMinusOne).not.toBe(current);
    expect(nMinusOne.paths).not.toBe(current.paths);
  });
});

describe("rolling N/N-1 wire compatibility", () => {
  it("the N-1 → N transition is the phantom cut plus the additive issue-#1011 surface", () => {
    const diff = diffOpenApi(nMinusOne, current);
    const kinds = diff.breaking.map((item) => item.kind);
    expect(kinds).toHaveLength(5);
    expect(kinds.every((kind) => kind === "endpoint-removed")).toBe(true);
    // Issue #1011 adds an optional Idempotency-Key header and a typed 409 to
    // saveSavedRoute. Both are additive on a shared operation — they never
    // change the request/success wire shape an N-1 client relies on.
    expect(diff.additive.map((item) => item.message)).toEqual([
      "POST /v1/users/saved-routes gained 409 error response",
    ]);
  });

  it("every shared operation keeps its client-facing wire shape in both versions", () => {
    const previousByKey = operationMap(nMinusOne);
    const currentByKey = operationMap(current);
    for (const key of currentKeys) {
      expect(clientWireShape(previousByKey.get(key))).toEqual(clientWireShape(currentByKey.get(key)));
    }
  });

  it("a saved-routes request N-1 clients produced still parses under N", () => {
    const request = {
      id: "00000000-0000-4000-8000-000000000009",
      title: "Tokyo pilgrimage",
      point_ids: ["p1", "p2"],
    };
    const inputSchema = usersContract.saveSavedRoute["~orpc"].inputSchema;
    expect(inputSchema).toBeDefined();
    expect(inputSchema?.safeParse(request).success).toBe(true);
  });
});

describe("version-invariant binding protocol", () => {
  it("every N and N-1 operation is reached under the single shared prefix", () => {
    const paths = [...currentOps, ...previousOps].map((operation) => operation.path);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith(USERS_BINDING_PREFIX)).toBe(true);
    }
  });

  it("the identity headers the edge forwards are the same for both versions", () => {
    expect(USER_IDENTITY_HEADER).toBe("X-User-Id");
    expect(USER_TYPE_HEADER).toBe("X-User-Type");
    expect(AUTHORIZATION_HEADER).toBe("Authorization");
    expect(USERS_BINDING_PREFIX).toBe("/v1/users/");
  });

  it("shared operations require the same bearer credential in both versions", () => {
    const previousByKey = operationMap(nMinusOne);
    const currentByKey = operationMap(current);
    for (const key of currentKeys) {
      expect(currentByKey.get(key)?.security).toBeDefined();
      expect(previousByKey.get(key)?.security).toEqual(currentByKey.get(key)?.security);
    }
  });
});
