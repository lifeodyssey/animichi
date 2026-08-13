/**
 * OpenAPI diff classification — schema changes (issue #1005 AC4).
 *
 * Schema-level changes: property additions/removals, property type changes,
 * request/response schema presence, request-body requiredness, property
 * requiredness, and enum members. Each case asserts the exact kind and
 * severity, so a classification regression fails loudly.
 */

import { describe, expect, it } from "vitest";
import { diffOpenApi } from "../src/openapi-diff.js";
import type { WireSchema } from "../src/operation-set.js";
import { body, breakingKinds, doc, op } from "./openapi-diff-builders.js";

describe("schema changes", () => {
  const baseline = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { title: { type: "string" }, notes: { type: "string" } }, required: ["title"] }) } });

  it("classifies a property removal as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { title: { type: "string" } }, required: ["title"] }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(breakingKinds(diff)).toEqual(["schema-property-removed"]);
  });

  it("classifies a property addition as additive", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { title: { type: "string" }, notes: { type: "string" }, pinned: { type: "boolean" } }, required: ["title"] }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["schema-property-added"]);
  });

  it("classifies a property type change as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { title: { type: "number" }, notes: { type: "string" } }, required: ["title"] }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(breakingKinds(diff)).toEqual(["schema-property-type-changed"]);
  });
});

describe("request/response schema presence", () => {
  const responseSchema: WireSchema = { type: "object", properties: { id: { type: "string" } } };
  const requestSchema: WireSchema = { type: "object", properties: { title: { type: "string" } } };
  const withRequiredRequest = doc({ "/v1/users/saved-routes": { post: op(responseSchema, { requestBody: body(true, requestSchema) }) } });
  const withOptionalRequest = doc({ "/v1/users/saved-routes": { post: op(responseSchema, { requestBody: body(false, requestSchema) }) } });
  const withoutRequest = doc({ "/v1/users/saved-routes": { post: op(responseSchema) } });

  it("classifies a request schema removal as breaking", () => {
    const diff = diffOpenApi(withRequiredRequest, withoutRequest);
    expect(breakingKinds(diff)).toEqual(["request-schema-removed"]);
    expect(diff.additive).toEqual([]);
  });

  it("classifies a request schema addition as additive", () => {
    const diff = diffOpenApi(withoutRequest, withOptionalRequest);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["request-schema-added"]);
  });

  it("classifies a response schema removal as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op(undefined, { requestBody: body(true, requestSchema) }) } });
    const diff = diffOpenApi(withRequiredRequest, candidate);
    expect(breakingKinds(diff)).toEqual(["response-schema-removed"]);
    expect(diff.additive).toEqual([]);
  });

  it("classifies a response schema addition as additive", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op(undefined, { requestBody: body(true, requestSchema) }) } });
    const diff = diffOpenApi(candidate, withRequiredRequest);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["response-schema-added"]);
  });
});

describe("request body requiredness changes", () => {
  const schema: WireSchema = { type: "object", properties: { title: { type: "string" } } };
  const baseline = doc({ "/v1/users/saved-routes": { post: op(undefined, { requestBody: body(true, schema) }) } });
  const optionalBody = doc({ "/v1/users/saved-routes": { post: op(undefined, { requestBody: body(false, schema) }) } });
  const noBody = doc({ "/v1/users/saved-routes": { post: op() } });

  it("classifies an optional body becoming required as breaking", () => {
    const diff = diffOpenApi(optionalBody, baseline);
    expect(breakingKinds(diff)).toEqual(["request-body-required"]);
  });

  it("classifies a required body becoming optional as additive", () => {
    const diff = diffOpenApi(baseline, optionalBody);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["request-body-optional"]);
  });

  it("classifies a newly required body added to a body-less operation as breaking", () => {
    const diff = diffOpenApi(noBody, baseline);
    expect(breakingKinds(diff)).toEqual(["request-body-required"]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["request-schema-added"]);
  });

  it("classifies a newly optional body added to a body-less operation as additive", () => {
    const diff = diffOpenApi(noBody, optionalBody);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["request-schema-added"]);
  });
});

describe("requiredness changes", () => {
  const baseline = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { title: { type: "string" } }, required: [] }) } });
  const requiredTitle = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { title: { type: "string" } }, required: ["title"] }) } });

  it("classifies a property becoming required as breaking", () => {
    const diff = diffOpenApi(baseline, requiredTitle);
    expect(breakingKinds(diff)).toEqual(["schema-property-required"]);
  });

  it("classifies a property becoming optional as additive", () => {
    const diff = diffOpenApi(requiredTitle, baseline);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["schema-property-optional"]);
  });
});

describe("enum changes", () => {
  const baseline = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { status: { type: "string", enum: ["draft", "saved"] } }, required: ["status"] }) } });

  it("classifies an enum member removal as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { status: { type: "string", enum: ["saved"] } }, required: ["status"] }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(breakingKinds(diff)).toEqual(["enum-member-removed"]);
  });

  it("classifies an enum member addition as additive", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { status: { type: "string", enum: ["draft", "saved", "completed"] } }, required: ["status"] }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["enum-member-added"]);
  });

  it("classifies gaining an enum constraint as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { status: { type: "string" } }, required: ["status"] }) } });
    const diff = diffOpenApi(candidate, baseline);
    expect(breakingKinds(diff)).toEqual(["enum-constraint-added"]);
  });

  it("classifies losing an enum constraint as additive", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op({ type: "object", properties: { status: { type: "string" } }, required: ["status"] }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["enum-constraint-removed"]);
  });
});
