/**
 * Recursive OpenAPI schema-node differ (issue #1005 AC4).
 *
 * One JSON-schema node — type, enum members, array items, object properties,
 * and property requiredness — is diffed recursively here, driven by the
 * operation-level differ in `openapi-diff.ts`. Changes land in the
 * `ChangeSink` the driver opened for the operation being compared, so every
 * change carries the operation it was found under no matter how deep in the
 * node tree it was classified.
 */

import { change, type ApiChange, type ChangeSink } from "./openapi-changes.js";
import type { WireSchema } from "./operation-set.js";

function pushChange(sink: ChangeSink, kind: ApiChange["kind"], at: string, suffix: string): void {
  sink.out.push(change(kind, `${at} ${suffix}`, sink.operation));
}

function pushPropertyChange(
  sink: ChangeSink,
  kind: ApiChange["kind"],
  at: string,
  name: string,
  suffix: string,
): void {
  sink.out.push(change(kind, `${at}.${name} ${suffix}`, sink.operation));
}

/** Baseline→candidate property map pair at one object node. */
interface PropertiesPair {
  readonly baseline: Record<string, WireSchema>;
  readonly candidate: Record<string, WireSchema>;
}

/** Baseline→candidate property pair at one property position. */
interface PropertyPair {
  readonly baseline: WireSchema | undefined;
  readonly candidate: WireSchema;
}

/** Baseline→candidate `required` name list pair. */
interface RequirednessPair {
  readonly baseline: readonly string[];
  readonly candidate: readonly string[];
}

/** A normalized structural key so different shapes compare by value. */
function typeKey(schema: WireSchema): string {
  if (schema.$ref !== undefined) return `ref:${schema.$ref}`;
  if (schema.type !== undefined) return schema.type;
  if (schema.anyOf !== undefined) {
    const members = schema.anyOf.map(typeKey).sort().join("|");
    return `anyOf:${members}`;
  }
  return "unknown";
}

function diffTypeChange(
  baseline: WireSchema,
  candidate: WireSchema,
  at: string,
  sink: ChangeSink,
): void {
  const message = `${at} changed type from ${typeKey(baseline)} to ${typeKey(candidate)}`;
  sink.out.push(change("schema-property-type-changed", message, sink.operation));
}

/** Diff one schema node's structure recursively. */
export function diffSchema(baseline: WireSchema, candidate: WireSchema, at: string, sink: ChangeSink): void {
  if (typeKey(baseline) !== typeKey(candidate)) {
    diffTypeChange(baseline, candidate, at, sink);
    return;
  }
  diffSameTypeSchema(baseline, candidate, at, sink);
}

function gainedEnumConstraint(
  baseline: WireSchema,
  candidate: WireSchema,
  at: string,
  sink: ChangeSink,
): void {
  if (baseline.enum === undefined && candidate.enum !== undefined) {
    pushChange(sink, "enum-constraint-added", at, "gained an enum constraint");
  }
}

function lostEnumConstraint(
  baseline: WireSchema,
  candidate: WireSchema,
  at: string,
  sink: ChangeSink,
): void {
  if (baseline.enum !== undefined && candidate.enum === undefined) {
    pushChange(sink, "enum-constraint-removed", at, "lost its enum constraint");
  }
}

function diffEnumShape(baseline: WireSchema, candidate: WireSchema, at: string, sink: ChangeSink): void {
  gainedEnumConstraint(baseline, candidate, at, sink);
  lostEnumConstraint(baseline, candidate, at, sink);
  if (baseline.enum !== undefined && candidate.enum !== undefined) {
    diffEnumMembers(baseline.enum, candidate.enum, at, sink);
  }
}

function diffCollectionSchema(baseline: WireSchema, candidate: WireSchema, at: string, sink: ChangeSink): void {
  if (baseline.type === "array") {
    diffArrayItems(baseline, candidate, at, sink);
    return;
  }
  if (baseline.type === "object") {
    diffObjectSchema(baseline, candidate, at, sink);
  }
}

function diffSameTypeSchema(baseline: WireSchema, candidate: WireSchema, at: string, sink: ChangeSink): void {
  if (baseline.enum !== undefined || candidate.enum !== undefined) {
    diffEnumShape(baseline, candidate, at, sink);
    return;
  }
  diffCollectionSchema(baseline, candidate, at, sink);
}

function removedMembers(baseline: readonly unknown[], candidate: readonly unknown[]): unknown[] {
  const candidateSet = new Set(candidate);
  return baseline.filter((member) => !candidateSet.has(member));
}

function addedMembers(baseline: readonly unknown[], candidate: readonly unknown[]): unknown[] {
  const baselineSet = new Set(baseline);
  return candidate.filter((member) => !baselineSet.has(member));
}

function diffEnumMembers(
  baseline: readonly unknown[], candidate: readonly unknown[], at: string, sink: ChangeSink,
): void {
  diffRemovedEnumMembers(baseline, candidate, at, sink);
  diffAddedEnumMembers(baseline, candidate, at, sink);
}

function diffRemovedEnumMembers(
  baseline: readonly unknown[], candidate: readonly unknown[], at: string, sink: ChangeSink,
): void {
  for (const member of removedMembers(baseline, candidate)) {
    pushChange(sink, "enum-member-removed", at, `lost enum member ${String(member)}`);
  }
}

function diffAddedEnumMembers(
  baseline: readonly unknown[], candidate: readonly unknown[], at: string, sink: ChangeSink,
): void {
  for (const member of addedMembers(baseline, candidate)) {
    pushChange(sink, "enum-member-added", at, `gained enum member ${String(member)}`);
  }
}

function diffArrayItems(
  baseline: WireSchema,
  candidate: WireSchema,
  at: string,
  sink: ChangeSink,
): void {
  if (baseline.items !== undefined && candidate.items !== undefined) {
    diffSchema(baseline.items, candidate.items, `${at}[]`, sink);
  }
}

function diffObjectSchema(baseline: WireSchema, candidate: WireSchema, at: string, sink: ChangeSink): void {
  diffObjectProperties({ baseline: baseline.properties ?? {}, candidate: candidate.properties ?? {} }, at, sink);
  diffRequiredness(baseline.required ?? [], candidate.required ?? [], at, sink);
}

function diffObjectProperties(props: PropertiesPair, at: string, sink: ChangeSink): void {
  diffAddedProperties(props, at, sink);
  diffRemovedProperties(props, at, sink);
}

function addedPropertyNames(props: PropertiesPair): string[] {
  return Object.keys(props.candidate).filter((name) => props.baseline[name] === undefined);
}

function diffAddedProperties(props: PropertiesPair, at: string, sink: ChangeSink): void {
  for (const name of addedPropertyNames(props)) {
    pushPropertyChange(sink, "schema-property-added", at, name, "was added");
  }
}

function pushRemovedProperty(props: PropertiesPair, name: string, at: string, sink: ChangeSink): void {
  const candidateProp = props.candidate[name];
  if (candidateProp === undefined) {
    pushPropertyChange(sink, "schema-property-removed", at, name, "was removed");
  } else {
    diffSharedProperty({ baseline: props.baseline[name], candidate: candidateProp }, `${at}.${name}`, sink);
  }
}

function diffRemovedProperties(props: PropertiesPair, at: string, sink: ChangeSink): void {
  for (const name of Object.keys(props.baseline)) {
    pushRemovedProperty(props, name, at, sink);
  }
}

function diffSharedProperty(prop: PropertyPair, position: string, sink: ChangeSink): void {
  if (prop.baseline !== undefined) {
    diffSchema(prop.baseline, prop.candidate, position, sink);
  }
}

function diffRequiredness(
  baselineRequired: readonly string[],
  candidateRequired: readonly string[],
  at: string,
  sink: ChangeSink,
): void {
  diffNewlyRequired({ baseline: baselineRequired, candidate: candidateRequired }, at, sink);
  diffNewlyOptional({ baseline: baselineRequired, candidate: candidateRequired }, at, sink);
}

function newlyRequiredNames(baselineRequired: readonly string[], candidateRequired: readonly string[]): string[] {
  const baselineSet = new Set(baselineRequired);
  return candidateRequired.filter((name) => !baselineSet.has(name));
}

function newlyOptionalNames(baselineRequired: readonly string[], candidateRequired: readonly string[]): string[] {
  const candidateSet = new Set(candidateRequired);
  return baselineRequired.filter((name) => !candidateSet.has(name));
}

function diffNewlyRequired(required: RequirednessPair, at: string, sink: ChangeSink): void {
  for (const name of newlyRequiredNames(required.baseline, required.candidate)) {
    pushPropertyChange(sink, "schema-property-required", at, name, "became required");
  }
}

function diffNewlyOptional(required: RequirednessPair, at: string, sink: ChangeSink): void {
  for (const name of newlyOptionalNames(required.baseline, required.candidate)) {
    pushPropertyChange(sink, "schema-property-optional", at, name, "became optional");
  }
}
