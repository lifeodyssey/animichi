/**
 * Canonicalizing a recorded prefix source (#1558 follow-up).
 *
 * A frozen source must be reproducible from its script and must never carry a
 * machine-specific value. The SDK mints uuidv7 entry, operation, usage and step
 * identifiers, the faux provider mints tool-call identifiers from its own clock
 * and randomness, and both stamp wall-clock readings — so a `provider: faux`
 * recording still differs byte for byte from the next one, and a secret scanner
 * reading `"key":"<uuid>"` sees a credential. The recorder rewrites both through
 * this module before it freezes bytes:
 *
 * - every identifier family becomes an ordered, human-readable placeholder
 *   (`op-0001`, `entry-0007`, `call-0002`) in first-appearance order, so two
 *   recordings of the same script canonicalize to the same bytes;
 * - every clock reading the tables below classify becomes the recorded epoch,
 *   which is the clock the recording repository is already given;
 * - a value the tables do not classify is refused, not rewritten: fixture
 *   entropy is a recording-path bug we fix, never a scanner to silence.
 *
 * The two guards are the backstop for the walk. `assertCanonicalIdentifiers`
 * refuses a session-minted token, and `assertNoWallClockReadings` refuses a
 * millisecond reading or an ISO timestamp, wherever they survive in the frozen
 * bytes — including inside a payload the walk treats as content.
 */
import { objectOrNull } from '../json-object.ts';
import type { PrefixState } from './prefix-corpus.ts';

/** The clock every frozen source is written at; the recording repository uses it too. */
export const RECORDED_EPOCH = 0;

/** One placeholder sequence per identifier family the SDK mints. */
type IdentifierRole = 'op' | 'entry' | 'usage' | 'step' | 'call';

const PLACEHOLDER_PREFIX: Readonly<Record<IdentifierRole, string>> = {
  op: 'op', entry: 'entry', usage: 'usage', step: 'step', call: 'call',
};

const PLACEHOLDER_DIGITS = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TOOL_CALL = /^tool:\d+:[0-9a-z]+$/u;
/** Identifier-shaped wherever it appears, including embedded in a recorded payload's text. */
const IDENTIFIER_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|tool:\d+:[0-9a-z]+/gu;
/** A millisecond reading: only the recorded epoch may remain in a frozen source. */
const MILLISECONDS_ANYWHERE = /(?:^|[^0-9])[0-9]{12,}(?:[^0-9]|$)/u;
const ISO_DATETIME_ANYWHERE = /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/u;

/**
 * Where a value sits decides what an identifier-shaped token means. Envelope
 * containers are the SDK's own records; `payload` is recorded content (tool
 * results, tool arguments, application scalars), where only unambiguous
 * envelope fields and already-mapped tokens count as identifiers.
 */
type Container = 'header' | 'entry' | 'usage' | 'message' | 'operation' | 'call' | 'payload';

/** Envelope fields that carry one identifier family, whatever container holds them. */
const ROLE_BY_FIELD = new Map<string, IdentifierRole>([
  ['operationId', 'op'], ['currentOperationId', 'op'], ['lastOperationId', 'op'],
  ['usageId', 'usage'], ['stepId', 'step'], ['toolCallId', 'call'],
  ['entryId', 'entry'], ['parentId', 'entry'], ['tipId', 'entry'], ['sourceTipId', 'entry'], ['fromTipId', 'entry'],
  ['latestAssistantEntryId', 'entry'], ['triggerEntryId', 'entry'], ['responseEntryId', 'entry'],
  ['assistantEntryId', 'entry'], ['resultEntryId', 'entry'], ['turnId', 'step'], ['promptEntryIds', 'entry'],
]);

/** The envelope fields a recorded payload may still carry; content does not name these. */
const UNAMBIGUOUS_FIELDS = new Set(['operationId', 'currentOperationId', 'lastOperationId', 'usageId', 'stepId', 'toolCallId']);

/** Positional roles of a namespace key: `pi.op.tool_args` is `op:entry:index`. */
const ROLE_BY_NAMESPACE = new Map<string, readonly IdentifierRole[]>([
  ['pi.op.meta', ['op']], ['pi.op.state', ['op']], ['pi.op.tool_args', ['op', 'step']],
  ['pi.result', ['op']], ['pi.pending.entry', ['entry']],
  ['pi.pending.assistant_frame', ['op', 'entry']], ['pi.pending.tool_output', ['op', 'entry']],
  ['pi.branch.tip', []], ['pi.lane.state', []], ['pi.lane.config', []],
]);

/** What a namespace's value is: an envelope record, a recorded payload, or one identifier. */
const CONTAINER_BY_NAMESPACE = new Map<string, Container>([
  ['pi.op.meta', 'operation'], ['pi.op.state', 'operation'], ['pi.result', 'operation'],
  ['pi.lane.state', 'operation'], ['pi.lane.config', 'operation'],
  ['pi.pending.entry', 'entry'], ['pi.pending.assistant_frame', 'operation'],
  ['pi.pending.tool_output', 'payload'], ['pi.op.tool_args', 'payload'],
]);

/** The owned namespace whose value is one identifier rather than an object. */
const VALUE_ROLE_BY_NAMESPACE = new Map<string, IdentifierRole>([['pi.branch.tip', 'entry']]);

/** Clocks the SDK stamps, by the container that owns them; anything else is refused. */
const CLOCK_FIELDS_BY_CONTAINER: Readonly<Partial<Record<Container, readonly string[]>>> = {
  header: ['createdAt'], entry: ['timestamp'], message: ['timestamp'],
  operation: ['startedAt', 'endedAt', 'requestedAt', 'notBefore', 'notAfter'],
};

const CLOCK_FIELDS = new Set(['timestamp', 'startedAt', 'endedAt', 'requestedAt', 'notBefore', 'notAfter', 'createdAt']);

/** What one canonicalization produced: the frozen bytes and the identifiers it rewrote. */
export interface CanonicalSource {
  readonly text: string;
  readonly ids: ReadonlyMap<string, string>;
}

/** The identifier mapping one source canonicalizes through; first appearance assigns the number. */
export class IdentifierMapping {
  private readonly roles = new Map<string, IdentifierRole>();
  private readonly counts = new Map<IdentifierRole, number>();
  private readonly placeholders = new Map<string, string>();
  private pattern: RegExp | undefined;

  /** The placeholder for a token, claiming a number the first time that token is seen. */
  claim(token: string, role: IdentifierRole, where: string): string {
    const claimed = this.placeholders.get(token);
    if (claimed !== undefined) {
      const claimedRole: IdentifierRole | undefined = this.roles.get(token);
      if (claimedRole !== role) throw new Error(`recorded identifier ${token} is claimed as both ${claimedRole ?? 'nothing'} and ${role} (${where})`);
      return claimed;
    }
    const next = (this.counts.get(role) ?? 0) + 1;
    const placeholder = `${PLACEHOLDER_PREFIX[role]}-${String(next).padStart(PLACEHOLDER_DIGITS, '0')}`;
    this.roles.set(token, role);
    this.counts.set(role, next);
    this.placeholders.set(token, placeholder);
    return placeholder;
  }

  placeholderOf(token: string): string | undefined {
    return this.placeholders.get(token);
  }

  /** Rewrite every claimed identifier in one string, embedded in a payload or not. */
  rewrite(value: string): string {
    if (this.placeholders.size === 0) return value;
    const pattern = this.pattern ??= new RegExp([...this.placeholders.keys()].map(escaped).join('|'), 'gu');
    return value.replace(pattern, (token) => this.placeholderOf(token) ?? token);
  }

  entries(): ReadonlyMap<string, string> {
    return this.placeholders;
  }
}

function escaped(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Canonicalize a frozen session text: placeholders for identifiers, the epoch for clocks. */
export function canonicalizeSessionText(text: string): CanonicalSource {
  const documents = parseSession(text);
  const mapping = new IdentifierMapping();
  for (const document of documents) discoverDocument(document, mapping);
  const lines = documents.map((document) => JSON.stringify(canonicalDocument(document, mapping)));
  const canonical = `${lines.join('\n')}${text.endsWith('\n') ? '\n' : ''}`;
  assertCanonicalIdentifiers(canonical);
  assertNoWallClockReadings(canonical);
  return { text: canonical, ids: mapping.entries() };
}

/** The boundary state, with every identifier it names mapped through the same mapping. */
export function canonicalRecordedState(state: PrefixState, ids: ReadonlyMap<string, string>): PrefixState {
  return {
    ...state, entry_id: requirePlaceholder(ids, state.entry_id),
    references: state.references.map((reference) => ({ ...reference, entry_id: requirePlaceholder(ids, reference.entry_id) })),
  };
}

/** Refuse frozen bytes that still carry a session-minted identifier. */
export function assertCanonicalIdentifiers(text: string): void {
  const [match] = identifierMatches(text);
  if (match?.index !== undefined) throw new Error(`frozen source carries a recorded identifier: ${excerpt(text, match.index)}`);
}

/** Refuse frozen bytes that still carry a wall-clock reading or an ISO timestamp. */
export function assertNoWallClockReadings(text: string): void {
  const match = MILLISECONDS_ANYWHERE.exec(text) ?? ISO_DATETIME_ANYWHERE.exec(text);
  if (match?.index !== undefined) throw new Error(`frozen source carries a wall-clock reading: ${excerpt(text, match.index)}`);
}

/** The bytes around a refusal, so the recording path names the position it could not canonicalize. */
function excerpt(text: string, index: number): string {
  return `…${text.slice(Math.max(0, index - 80), index + 80)}…`;
}

function requirePlaceholder(ids: ReadonlyMap<string, string>, token: string): string {
  const placeholder = ids.get(token);
  if (placeholder === undefined) throw new Error(`recorded state names ${token}, which the frozen bytes do not carry`);
  return placeholder;
}

/** One JSON document per line, and no reformatting: a line the writer did not serialize itself is refused. */
function parseSession(text: string): readonly unknown[] {
  const lines = text.split('\n');
  const body = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
  return body.map(parseLine);
}

function parseLine(line: string): unknown {
  const parsed: unknown = JSON.parse(line);
  if (JSON.stringify(parsed) !== line) throw new Error('frozen source: refusing to canonicalize a line the session writer did not serialize itself');
  return parsed;
}

function discoverDocument(document: unknown, mapping: IdentifierMapping): void {
  for (const write of writesOf(document)) discoverWrite(write, mapping);
}

/** A JSONL line keeps its shape: one write stays one write, a committed batch stays a batch. */
function canonicalDocument(document: unknown, mapping: IdentifierMapping): unknown {
  if (Array.isArray(document)) return document.map((write) => canonicalWrite(write, mapping));
  return canonicalWrite(document, mapping);
}

/** A JSONL line is one write or a committed batch of writes; anything else is not a session line. */
function writesOf(document: unknown): readonly unknown[] {
  return Array.isArray(document) ? document : [document];
}

function discoverWrite(write: unknown, mapping: IdentifierMapping): void {
  const record = objectOrNull(write);
  if (record === null) return;
  if (record.kind === 'header') { discoverFields(record, 'header', mapping); return; }
  if (record.kind === 'entry' || record.kind === 'usage') { discoverFields(record, record.kind, mapping); return; }
  discoverNamespace(record, mapping);
}

function discoverNamespace(record: Record<string, unknown>, mapping: IdentifierMapping): void {
  const namespace = typeof record.namespace === 'string' ? record.namespace : '';
  const roles = ROLE_BY_NAMESPACE.get(namespace);
  if (roles === undefined) { discoverFields(record, 'payload', mapping); return; }
  claimKeySegments(record.key, roles, namespace, mapping);
  const single = VALUE_ROLE_BY_NAMESPACE.get(namespace);
  if (single !== undefined) { claimToken(record.value, single, `${namespace} value`, mapping); return; }
  discoverFields(record.value, CONTAINER_BY_NAMESPACE.get(namespace) ?? 'payload', mapping);
}

/** The key of a namespace write is `role:role:...`: classify its first segments, refuse the rest. */
function claimKeySegments(key: unknown, roles: readonly IdentifierRole[], namespace: string, mapping: IdentifierMapping): void {
  if (typeof key !== 'string') return;
  for (const [index, segment] of key.split(':').entries()) {
    const role = roles[index];
    if (role !== undefined) claimToken(segment, role, `${namespace} key`, mapping);
    else if (isIdentifierShaped(segment)) throw new Error(`recorded identifier ${segment} sits past the classified segments of a session key`);
  }
}

function claimToken(token: unknown, role: IdentifierRole, where: string, mapping: IdentifierMapping): void {
  if (typeof token === 'string' && isIdentifierShaped(token)) mapping.claim(token, role, where);
}

function discoverFields(node: unknown, container: Container, mapping: IdentifierMapping): void {
  mapDocument(node, container, (field, value, where) => {
    if (typeof value === 'number') return discoverNumber(field, where);
    if (typeof value === 'string') return discoverString(field, value, where, mapping);
    return { kind: 'keep' };
  });
}

function discoverNumber(field: string, container: Container): FieldStep {
  if (CLOCK_FIELDS.has(field) && !isClockField(field, container)) {
    throw new Error(`recorded clock reading in ${container} field ${field}: the recorder pins only the clocks it classifies`);
  }
  return { kind: 'keep' };
}

function discoverString(field: string, value: string, container: Container, mapping: IdentifierMapping): FieldStep {
  const role = roleOf(field, value, container);
  if (role !== undefined) {
    mapping.claim(value, role, `${container} field ${field}`);
    return { kind: 'keep' };
  }
  assertMappedIdentifiers(field, value, container, mapping);
  return { kind: 'keep' };
}

/** A recorded payload may repeat an identifier the recorder already mapped; it may not invent one. */
function assertMappedIdentifiers(field: string, value: string, container: Container, mapping: IdentifierMapping): void {
  const unmapped = identifierMatches(value).find((match) => mapping.placeholderOf(match[0]) === undefined);
  if (unmapped !== undefined) throw new Error(`recorded identifier ${unmapped[0]} in ${container} field ${field}: the recorder canonicalizes only the identifiers it classifies`);
}

function canonicalWrite(write: unknown, mapping: IdentifierMapping): unknown {
  const record = objectOrNull(write);
  if (record === null) return write;
  if (record.kind === 'header') return canonicalFields(record, 'header', mapping);
  if (record.kind === 'entry' || record.kind === 'usage') return canonicalFields(record, record.kind, mapping);
  const canonical = objectOrNull(canonicalFields(record, namespaceContainer(record), mapping)) ?? {};
  const single = typeof record.namespace === 'string' ? VALUE_ROLE_BY_NAMESPACE.get(record.namespace) : undefined;
  return single === undefined ? canonical : { ...canonical, value: mapSegments(record.value, mapping) };
}

function canonicalFields(node: unknown, container: Container, mapping: IdentifierMapping): unknown {
  return mapDocument(node, container, (field, value, where) => {
    if (typeof value === 'number') return { kind: 'replace', value: isClockField(field, where) ? RECORDED_EPOCH : value };
    if (typeof value === 'string') return { kind: 'replace', value: mapSegments(value, mapping) };
    return { kind: 'keep' };
  });
}

/** Rewrite the identifiers of one string value; a segment that is not a token stays verbatim. */
function mapSegments(value: unknown, mapping: IdentifierMapping): unknown {
  return typeof value === 'string' ? mapping.rewrite(value) : value;
}

function namespaceContainer(record: Record<string, unknown>): Container {
  return typeof record.namespace === 'string' ? CONTAINER_BY_NAMESPACE.get(record.namespace) ?? 'payload' : 'payload';
}

function identifierMatches(text: string): RegExpMatchArray[] {
  return [...text.matchAll(IDENTIFIER_ANYWHERE)];
}

function isIdentifierShaped(value: string): boolean {
  return UUID.test(value) || TOOL_CALL.test(value);
}

function roleOf(field: string, value: string, container: Container): IdentifierRole | undefined {
  if (container === 'header') return undefined;
  if (TOOL_CALL.test(value)) return 'call';
  if (!UUID.test(value)) return undefined;
  const role = ROLE_BY_FIELD.get(field);
  if (role === undefined) return field === 'id' ? idRole(container) : undefined;
  return container === 'payload' && !UNAMBIGUOUS_FIELDS.has(field) ? undefined : role;
}

function idRole(container: Container): IdentifierRole | undefined {
  if (container === 'usage') return 'usage';
  return container === 'payload' ? undefined : 'entry';
}

function isClockField(field: string, container: Container): boolean {
  return CLOCK_FIELDS_BY_CONTAINER[container]?.includes(field) === true;
}

type FieldStep = { readonly kind: 'keep' } | { readonly kind: 'replace'; readonly value: unknown };
type FieldVisitor = (field: string, value: unknown, container: Container) => FieldStep;

/** One traversal both passes share, so a value classified once is rewritten by the same rule. */
function mapDocument(node: unknown, container: Container, visit: FieldVisitor): unknown {
  const record = objectOrNull(node);
  if (record === null) return node;
  const inner = record.type === 'toolCall' ? 'call' : container;
  const output: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) output[field] = mapField(field, value, inner, visit);
  return output;
}

/** An array carries the same field name for every element, so an element is visited like its scalar sibling. */
function mapField(field: string, value: unknown, container: Container, visit: FieldVisitor): unknown {
  if (Array.isArray(value)) return value.map((item) => mapField(field, item, container, visit));
  const step = visit(field, value, container);
  if (step.kind === 'replace') return step.value;
  if (typeof value !== 'object' || value === null) return value;
  return mapDocument(value, nestedContainer(field, container), visit);
}

function nestedContainer(field: string, container: Container): Container {
  if (field === 'message' || field === 'partial') return 'message';
  if (field === 'payload') return 'entry';
  if (field === 'content' || field === 'details' || field === 'arguments') return 'payload';
  return container;
}
