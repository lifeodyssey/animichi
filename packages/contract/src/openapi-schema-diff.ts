/**
 * Recursive OpenAPI schema-node differ (issue #1005 AC4).
 *
 * One JSON-schema node — type, enum members, array items, object properties,
 * and property requiredness — is diffed recursively here, driven by the
 * operation-level differ in `openapi-diff.ts`.
 */

import { change, type ApiChange } from "./openapi-changes.js";
import type { WireSchema } from "./operation-set.js";

function pushChange(out: ApiChange[], kind: ApiChange["kind"], at: string, suffix: string): void {
  out.push(change(kind, `${at} ${suffix}`));
}

function pushPropertyChange(out: ApiChange[], kind: ApiChange["kind"], at: string, name: string, suffix: string): void {
  out.push(change(kind, `${at}.${name} ${suffix}`));
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
  out: ApiChange[],
): void {
  const message = `${at} changed type from ${typeKey(baseline)} to ${typeKey(candidate)}`;
  out.push(change("schema-property-type-changed", message));
}

/** Diff one schema node's structure recursively. */
export function diffSchema(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  if (typeKey(baseline) !== typeKey(candidate)) {
    diffTypeChange(baseline, candidate, at, out);
    return;
  }
  diffSameTypeSchema(baseline, candidate, at, out);
}

function gainedEnumConstraint(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  if (baseline.enum === undefined && candidate.enum !== undefined) {
    pushChange(out, "enum-constraint-added", at, "gained an enum constraint");
  }
}

function lostEnumConstraint(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  if (baseline.enum !== undefined && candidate.enum === undefined) {
    pushChange(out, "enum-constraint-removed", at, "lost its enum constraint");
  }
}

function diffEnumShape(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  gainedEnumConstraint(baseline, candidate, at, out);
  lostEnumConstraint(baseline, candidate, at, out);
  if (baseline.enum !== undefined && candidate.enum !== undefined) {
    diffEnumMembers(baseline.enum, candidate.enum, at, out);
  }
}

function diffCollectionSchema(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  if (baseline.type === "array") {
    diffArrayItems(baseline, candidate, at, out);
    return;
  }
  if (baseline.type === "object") {
    diffObjectSchema(baseline, candidate, at, out);
  }
}

function diffSameTypeSchema(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  if (baseline.enum !== undefined || candidate.enum !== undefined) {
    diffEnumShape(baseline, candidate, at, out);
    return;
  }
  diffCollectionSchema(baseline, candidate, at, out);
}

function removedMembers(baseline: readonly unknown[], candidate: readonly unknown[]): unknown[] {
  const candidateSet = new Set(candidate);
  return baseline.filter((member) => !candidateSet.has(member));
}

function addedMembers(baseline: readonly unknown[], candidate: readonly unknown[]): unknown[] {
  const baselineSet = new Set(baseline);
  return candidate.filter((member) => !baselineSet.has(member));
}

function diffEnumMembers(baseline: readonly unknown[], candidate: readonly unknown[], at: string, out: ApiChange[]): void {
  for (const member of removedMembers(baseline, candidate)) {
    pushChange(out, "enum-member-removed", at, `lost enum member ${String(member)}`);
  }
  for (const member of addedMembers(baseline, candidate)) {
    pushChange(out, "enum-member-added", at, `gained enum member ${String(member)}`);
  }
}

function diffArrayItems(
  baseline: WireSchema,
  candidate: WireSchema,
  at: string,
  out: ApiChange[],
): void {
  if (baseline.items !== undefined && candidate.items !== undefined) {
    diffSchema(baseline.items, candidate.items, `${at}[]`, out);
  }
}

function diffObjectSchema(baseline: WireSchema, candidate: WireSchema, at: string, out: ApiChange[]): void {
  diffObjectProperties({ baseline: baseline.properties ?? {}, candidate: candidate.properties ?? {} }, at, out);
  diffRequiredness(baseline.required ?? [], candidate.required ?? [], at, out);
}

function diffObjectProperties(props: PropertiesPair, at: string, out: ApiChange[]): void {
  diffAddedProperties(props, at, out);
  diffRemovedProperties(props, at, out);
}

function addedPropertyNames(props: PropertiesPair): string[] {
  return Object.keys(props.candidate).filter((name) => props.baseline[name] === undefined);
}

function diffAddedProperties(props: PropertiesPair, at: string, out: ApiChange[]): void {
  for (const name of addedPropertyNames(props)) {
    pushPropertyChange(out, "schema-property-added", at, name, "was added");
  }
}

function pushRemovedProperty(props: PropertiesPair, name: string, at: string, out: ApiChange[]): void {
  const candidateProp = props.candidate[name];
  if (candidateProp === undefined) {
    pushPropertyChange(out, "schema-property-removed", at, name, "was removed");
  } else {
    diffSharedProperty({ baseline: props.baseline[name], candidate: candidateProp }, `${at}.${name}`, out);
  }
}

function diffRemovedProperties(props: PropertiesPair, at: string, out: ApiChange[]): void {
  for (const name of Object.keys(props.baseline)) {
    pushRemovedProperty(props, name, at, out);
  }
}

function diffSharedProperty(prop: PropertyPair, position: string, out: ApiChange[]): void {
  if (prop.baseline !== undefined) {
    diffSchema(prop.baseline, prop.candidate, position, out);
  }
}

function diffRequiredness(baselineRequired: readonly string[], candidateRequired: readonly string[], at: string, out: ApiChange[]): void {
  diffNewlyRequired({ baseline: baselineRequired, candidate: candidateRequired }, at, out);
  diffNewlyOptional({ baseline: baselineRequired, candidate: candidateRequired }, at, out);
}

function newlyRequiredNames(baselineRequired: readonly string[], candidateRequired: readonly string[]): string[] {
  const baselineSet = new Set(baselineRequired);
  return candidateRequired.filter((name) => !baselineSet.has(name));
}

function newlyOptionalNames(baselineRequired: readonly string[], candidateRequired: readonly string[]): string[] {
  const candidateSet = new Set(candidateRequired);
  return baselineRequired.filter((name) => !candidateSet.has(name));
}

function diffNewlyRequired(required: RequirednessPair, at: string, out: ApiChange[]): void {
  for (const name of newlyRequiredNames(required.baseline, required.candidate)) {
    pushPropertyChange(out, "schema-property-required", at, name, "became required");
  }
}

function diffNewlyOptional(required: RequirednessPair, at: string, out: ApiChange[]): void {
  for (const name of newlyOptionalNames(required.baseline, required.candidate)) {
    pushPropertyChange(out, "schema-property-optional", at, name, "became optional");
  }
}
