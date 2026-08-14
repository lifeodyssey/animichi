/**
 * OpenAPI compatibility gate (issue #1005 AC5, integration).
 *
 * Runs the vet against the committed `/v1` surface — the published baseline —
 * proving: unapproved breaking changes fail, additive changes pass, and a
 * future major-version path is only approved when the superseded operation
 * carries explicit `deprecated: true` + `x-sunset` metadata.
 */

import { describe, expect, it } from "vitest";
import { SUNSET_EXTENSION, vetOpenApiDiff } from "../src/openapi-vet.js";
import type { ApiDocument, WireContent, WireOperation, WireSchema } from "../src/operation-set.js";
import usersOpenApiJson from "../users-openapi.json";

const BASELINE = usersOpenApiJson as ApiDocument;

/** Narrow a clone's optional schema to its defined value, or fail the test. */
function assertSchema(schema: WireSchema | undefined): asserts schema is WireSchema {
  expect(schema).toBeDefined();
}

/** Narrow a clone's optional JSON media type to its defined value. */
function assertMedia(media: WireContent["application/json"] | undefined): asserts media is WireContent["application/json"] {
  expect(media).toBeDefined();
}

type WireRequestBody = NonNullable<WireOperation["requestBody"]>;

/** Narrow a clone's optional request body to its defined value. */
function assertRequestBody(body: WireOperation["requestBody"]): asserts body is WireRequestBody {
  expect(body).toBeDefined();
}

function clone(document: ApiDocument): ApiDocument {
  return JSON.parse(JSON.stringify(document)) as ApiDocument;
}

describe("unapproved breaking changes fail", () => {
  it("removing the saved-route list endpoint fails the gate", () => {
    const candidate = clone(BASELINE);
    delete candidate.paths["/v1/users/saved-routes"].get;
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(false);
    expect(result.violations.some((message) => message.includes("GET /v1/users/saved-routes was removed"))).toBe(true);
  });

  it("making a saved-route field required fails the gate", () => {
    const candidate = clone(BASELINE);
    const post = candidate.paths["/v1/users/saved-routes"].post;
    const schema = post.requestBody?.content?.["application/json"]?.schema;
    assertSchema(schema);
    schema.required = [...(schema.required ?? []), "id"];
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(false);
    expect(result.violations.some((message) => message.includes("became required"))).toBe(true);
  });

  it("the same breaking change passes when explicitly approved", () => {
    const candidate = clone(BASELINE);
    delete candidate.paths["/v1/users/saved-routes"].get;
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: true });
    expect(result.approved).toBe(true);
    expect(result.breaking.length).toBeGreaterThan(0);
  });
});

describe("additive changes pass", () => {
  it("adding a read endpoint to /v1 is approved without approval flags", () => {
    const candidate = clone(BASELINE);
    const added: WireOperation = {
      summary: "Read one saved route",
      responses: { "200": { description: "OK" } },
    };
    candidate.paths["/v1/users/saved-routes/{id}"].get = added;
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(true);
    expect(result.additive.some((change) => change.message.includes("GET /v1/users/saved-routes/{id} was added"))).toBe(true);
  });

  it("adding an error response is additive and passes", () => {
    // 422 is not yet declared on the committed POST (issue #1011 added 409);
    // a genuinely new error response must be approved without approval flags.
    const candidate = clone(BASELINE);
    const responses = candidate.paths["/v1/users/saved-routes"].post.responses;
    responses["422"] = { description: "conflict" };
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(true);
    expect(result.additive.some((change) => change.kind === "error-response-added")).toBe(true);
  });
});

describe("schema presence mutations are classified, never silent (#1005 AC4)", () => {
  it("removing the POST request schema fails the gate (mutation probe)", () => {
    const candidate = clone(BASELINE);
    const post = candidate.paths["/v1/users/saved-routes"].post;
    const requestContent = post.requestBody?.content?.["application/json"];
    assertMedia(requestContent);
    requestContent.schema = undefined;
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(false);
    expect(result.breaking.some((change) => change.kind === "request-schema-removed")).toBe(true);
    expect(result.violations.some((message) => message.includes("request schema was removed"))).toBe(true);
  });

  it("removing the GET response schema fails the gate", () => {
    const candidate = clone(BASELINE);
    const get = candidate.paths["/v1/users/saved-routes"].get;
    const responseContent = get.responses["200"].content?.["application/json"];
    assertMedia(responseContent);
    responseContent.schema = undefined;
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(false);
    expect(result.breaking.some((change) => change.kind === "response-schema-removed")).toBe(true);
  });

  it("adding a request schema to a body-less operation passes (additive)", () => {
    const candidate = clone(BASELINE);
    const del = candidate.paths["/v1/users/saved-routes/{id}"].delete;
    del.requestBody = {
      content: { "application/json": { schema: { type: "object", properties: { note: { type: "string" } } } } },
    };
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(true);
    expect(result.additive.some((change) => change.kind === "request-schema-added")).toBe(true);
  });

  it("the same breaking schema removal passes only when explicitly approved", () => {
    const candidate = clone(BASELINE);
    const post = candidate.paths["/v1/users/saved-routes"].post;
    const requestContent = post.requestBody?.content?.["application/json"];
    assertMedia(requestContent);
    requestContent.schema = undefined;
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: true });
    expect(result.approved).toBe(true);
    expect(result.breaking.some((change) => change.kind === "request-schema-removed")).toBe(true);
  });
});

describe("request body requiredness changes pass or fail the gate", () => {
  it("marking the request body optional passes; marking it required fails", () => {
    const optional = clone(BASELINE);
    const post = optional.paths["/v1/users/saved-routes"].post;
    const requestBody = post.requestBody;
    assertRequestBody(requestBody);
    requestBody.required = false;
    const additive = vetOpenApiDiff(BASELINE, optional, { allowBreaking: false });
    expect(additive.approved).toBe(true);
    expect(additive.additive.some((change) => change.kind === "request-body-optional")).toBe(true);

    const tightened = clone(BASELINE);
    tightened.paths["/v1/users/saved-routes/{id}"].delete.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "string" } } },
    };
    const breaking = vetOpenApiDiff(BASELINE, tightened, { allowBreaking: false });
    expect(breaking.approved).toBe(false);
    expect(breaking.breaking.some((change) => change.kind === "request-body-required")).toBe(true);
  });
});

describe("future major-version path requires deprecation/sunset metadata", () => {
  const V2_ROUTE: WireOperation = {
    summary: "Create or update a saved route (v2)",
    responses: { "200": { description: "OK" } },
  };

  it("a /v2 path without deprecating the /v1 counterpart fails", () => {
    const candidate = clone(BASELINE);
    candidate.paths["/v2/users/saved-routes"] = { post: V2_ROUTE };
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(false);
    expect(result.violations.some((message) => message.includes("future major path"))).toBe(true);
  });

  it("a /v2 path passes once the /v1 operation carries deprecated + x-sunset", () => {
    const candidate = clone(BASELINE);
    const v1 = candidate.paths["/v1/users/saved-routes"].post;
    v1.deprecated = true;
    v1[SUNSET_EXTENSION] = "2027-01-01T00:00:00Z";
    candidate.paths["/v2/users/saved-routes"] = { post: V2_ROUTE };
    const result = vetOpenApiDiff(BASELINE, candidate, { allowBreaking: false });
    expect(result.approved).toBe(true);
  });
});
