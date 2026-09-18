/**
 * The two named operations this service exists to perform (#1792), built from
 * the committed capture of the upstream's API document,
 * `../anitabi-api-surface.json`.
 *
 * This module is the service's primary control: the upstream URL is assembled
 * HERE, from the capture's own path templates, so no request input can name
 * another destination. There is no parameter, header, or path segment
 * anywhere in the service that selects a host, a path, or a URL — the only
 * inputs that reach {@link upstreamUrlFor} are the operation the capture
 * declares and the numeric bangumi id this module parsed out of that
 * operation's route. Everything else resolves to null, and null has no
 * upstream URL.
 *
 * The capture is the ONLY widening point: this module builds its routes from
 * `surface.operations` and hardcodes none, so a third operation cannot be
 * acquired anywhere else. That also means the capture's own contents are the
 * thing to freeze — `test/upstream-operations.unit.test.ts` pins the permitted
 * set by name, so widening it is a reviewed edit to two files rather than a
 * quiet one to a constant.
 */
import capture from "../anitabi-api-surface.json";

/** One permitted operation, as the capture spells it. */
export interface OperationSpec {
  readonly name: string;
  /** The route this service serves, `{bangumiId}` standing for the id. */
  readonly egressPathTemplate: string;
  /** The upstream path that operation maps onto, same placeholder. */
  readonly upstreamPathTemplate: string;
  /** The operation's permitted query parameters, and nothing else. */
  readonly query: readonly { readonly name: string; readonly value: string }[];
}

/** The permitted surface of the upstream's API document, as data. */
export interface AnitabiApiSurface {
  readonly document: string;
  readonly capturedFrom: string;
  readonly apiOrigin: string;
  readonly imageOrigin: string;
  readonly forbiddenMainOrigin: string;
  readonly bangumiBasePath: string;
  readonly userAgent: string;
  readonly agreedUpstreamRequestsPerHour: number;
  readonly imagePlans: {
    readonly queryParameter: string;
    readonly values: readonly string[];
    readonly fullResolution: string;
  };
  readonly operations: readonly OperationSpec[];
}

const surface: AnitabiApiSurface = capture;

/** The permitted surface itself, for the tests and the operating docs. */
export const ANITABI_API_SURFACE = surface;

/** The one upstream this service talks to. Never configurable, never derived from input. */
export const ANITABI_UPSTREAM_ORIGIN = surface.apiOrigin;

/** The anitabi bangumi-API base both operations sit under. */
export const ANITABI_UPSTREAM_BASE = `${surface.apiOrigin}${surface.bangumiBasePath}`;

/** The identity every upstream request carries, per #1791. */
export const UPSTREAM_USER_AGENT = surface.userAgent;

/** One of the permitted operations, for one validated bangumi id. */
export interface EgressOperation {
  readonly spec: OperationSpec;
  readonly bangumiId: string;
}

/** The two route shapes, built from the capture's own templates. */
const ROUTES = surface.operations.map((spec) => ({
  spec,
  pattern: routePattern(spec.egressPathTemplate),
}));

/** Resolve a request path to one of the permitted operations, or null. Total: any other input resolves to null. */
export function resolveOperation(pathname: string): EgressOperation | null {
  for (const route of ROUTES) {
    const bangumiId = route.pattern.exec(pathname)?.[1];
    if (bangumiId !== undefined) return { spec: route.spec, bangumiId };
  }
  return null;
}

/** Build the upstream URL for an operation. The only place a destination is ever written. */
export function upstreamUrlFor(operation: EgressOperation): string {
  const path = operation.spec.upstreamPathTemplate.replace("{bangumiId}", operation.bangumiId);
  return `${surface.apiOrigin}${path}${queryOf(operation.spec)}`;
}

/** `^/anitabi/points/([1-9]\d*)$` from `^/anitabi/points/{bangumiId}$`. */
function routePattern(template: string): RegExp {
  const [head = "", tail = ""] = template.split("{bangumiId}");
  return new RegExp(`^${literal(head)}([1-9]\\d*)${literal(tail)}$`);
}

/** The operation's permitted query parameters, in the capture's order; empty when it permits none. */
function queryOf(spec: OperationSpec): string {
  if (spec.query.length === 0) return "";
  return "?" + spec.query.map((pair) => `${pair.name}=${pair.value}`).join("&");
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
