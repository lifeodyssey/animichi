/**
 * Recorded prefix corpora: frozen native JSONL sources plus the metadata a
 * forked attempt needs.
 *
 * A corpus is one `Dataset`-format manifest beside a `sources/` directory of
 * recorded format-4 sessions (#1558). Every case that declares a prefix is
 * bound to its frozen source: a missing source is a refused load, never a
 * case that silently degrades into an ordinary prompt. The manifest is read
 * as JSON and parsed by the official `Dataset.fromObject`, so its inputs,
 * recording provenance and expected-action metadata round-trip without a
 * Python or staging converter.
 *
 * The manifest never carries a credential: the recorder refuses to freeze a
 * source containing the value of a binding it read.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dataset } from 'logfire/evals';
import { z } from 'zod';

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** The recorded sources of one corpus live beside its manifest. */
export const PREFIX_CORPUS_ROOT = join(PACKAGE_DIR, 'fixtures', 'prefix-corpus');

/** `none` means the evaluated suffix contains no model-initiated tool call. */
export const NO_MODEL_TOOL = 'none';

/** The custom entry type that identifies deterministic server-side selection. */
export const SELECTION_ENTRY = 'animichi.selection';

const JsonScalar = z.union([z.string(), z.number()]);

/** One constraint on one argument, or on the geocode pair a place argument yields. */
export const ArgumentConstraint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enum'), argument: z.string().min(1), values: z.array(JsonScalar).min(1) }).strict(),
  z.object({
    kind: z.literal('set'), argument: z.string().min(1),
    values: z.array(JsonScalar).min(1), max_items: z.number().int().positive().optional(),
  }).strict(),
  z.object({ kind: z.literal('range'), argument: z.string().min(1), min: z.number().optional(), max: z.number().optional() }).strict(),
  z.object({
    kind: z.literal('bounds'), argument: z.string().min(1),
    min_lat: z.number(), max_lat: z.number(), min_lng: z.number(), max_lng: z.number(),
  }).strict(),
]);
export type ArgumentConstraint = z.infer<typeof ArgumentConstraint>;

const ForbiddenAction = z.object({
  tools: z.array(z.string().min(1)).default([]),
  arguments: z.array(ArgumentConstraint).default([]),
}).strict();

/** What the evaluated suffix must do first, as constraints rather than literals. */
export const ExpectedNextAction = z.object({
  tool: z.string().min(1),
  /** Required for `none`: the native domain entry that identifies the deterministic work. */
  domain_entry: z.string().min(1).optional(),
  arguments: z.array(ArgumentConstraint).default([]),
  forbidden: ForbiddenAction.optional(),
}).strict().superRefine((action, issue) => {
  if (action.tool === NO_MODEL_TOOL && action.domain_entry === undefined) {
    issue.addIssue({ code: 'custom', message: 'tool "none" must name the domain entry that replaces the model call' });
  }
});
export type ExpectedNextAction = z.infer<typeof ExpectedNextAction>;

/** Recording provenance: SDK, model, prompt/tool identity, commit and boundary. */
export const Recording = z.object({
  sdk: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt: z.string().regex(/^sha256:[0-9a-f]{12}$/),
  tools: z.array(z.string().min(1)).min(1),
  commit: z.string().min(1),
  boundary: z.string().min(1),
  catalog: z.string().min(1),
  recorded_at: z.iso.datetime(),
}).strict();
export type Recording = z.infer<typeof Recording>;

/** One candidate as the pending-selection domain projects it from committed entries. */
const PendingCandidate = z.object({
  id: z.string().min(1), title: z.string().min(1),
  cover_url: z.string().optional(), points_count: z.number().optional(),
  lat: z.number().optional(), lng: z.number().optional(), effective_radius_m: z.number().optional(),
}).strict();

/** Bounded native scalar state the tested action needs, copied by a tree fork alone. */
const RequiredScalar = z.object({
  namespace: z.string().min(1).refine((value) => !value.startsWith('pi.'), 'reserved pi namespaces are managed by the SDK'),
  key: z.string(), value: z.json(),
}).strict();

/** A durable result reference the frozen boundary keeps, resolvable by entry id. */
const DurableReference = z.object({
  kind: z.literal('search_result'),
  entry_id: z.string().min(1),
  tool: z.enum(['search_bangumi', 'search_nearby']),
}).strict();

/** The frozen boundary: the pending selection, its revision, references and required scalars. */
export const PrefixState = z.object({
  kind: z.literal('pending_selection'),
  reason: z.enum(['anime_ambiguity', 'place_ambiguity']),
  clarification_id: z.number().int(),
  entry_id: z.string().min(1),
  candidates: z.array(PendingCandidate).min(1),
  references: z.array(DurableReference).min(1),
  scalars: z.array(RequiredScalar),
}).strict();
export type PrefixState = z.infer<typeof PrefixState>;

/** Where one case's frozen source lives and which boundary it froze. */
export const PrefixSource = z.object({
  file: z.string().regex(/^[^/\\]+\.jsonl$/),
  session_id: z.string().min(1),
  boundary: z.string().min(1),
}).strict();
export type PrefixSource = z.infer<typeof PrefixSource>;

/** The deterministic selection the frozen boundary is evaluated with. */
export const PrefixSelectionInput = z.object({
  candidateIds: z.array(z.string().min(1)).min(1),
}).strict();
export type PrefixSelectionInput = z.infer<typeof PrefixSelectionInput>;

/** Native inputs of one prefix case: the prompt, locale, frozen source and action. */
export const PrefixCaseInput = z.object({
  prompt: z.string(),
  locale: z.string().min(1),
  prefix: PrefixSource,
  selection: PrefixSelectionInput.optional(),
}).strict();
export type PrefixCaseInput = z.infer<typeof PrefixCaseInput>;

/** Expected deterministic outcome of the frozen boundary's own action. */
export const ExpectedSelection = z.object({
  status: z.enum(['ok', 'empty', 'partial', 'error', 'too_large']),
  expect_nonempty: z.boolean(),
}).strict();
export type ExpectedSelection = z.infer<typeof ExpectedSelection>;

export const PrefixCaseMetadata = z.object({
  recording: Recording,
  expected_next_action: ExpectedNextAction,
  prefix_state: PrefixState,
  expected_selection: ExpectedSelection.optional(),
}).strict();
export type PrefixCaseMetadata = z.infer<typeof PrefixCaseMetadata>;

export interface PrefixCase {
  readonly name: string;
  readonly inputs: PrefixCaseInput;
  readonly metadata: PrefixCaseMetadata;
  /** Absolute path of the frozen source this case is bound to. */
  readonly sourcePath: string;
}

export interface LoadedPrefixCorpus {
  readonly name: string;
  readonly cases: readonly PrefixCase[];
}

/** A declared prefix whose frozen evidence is absent. Never a degraded case. */
export class PrefixEvidenceMissingError extends Error {
  constructor(where: string, sourcePath: string) {
    super(`${where}: declared a required prefix but its frozen source is missing: ${sourcePath}`);
    this.name = 'PrefixEvidenceMissingError';
  }
}

/** Load one corpus manifest and bind every case to the frozen source it declares. */
export async function loadPrefixCorpus(name: string, root: string = PREFIX_CORPUS_ROOT): Promise<LoadedPrefixCorpus> {
  const path = join(root, `${name}.json`);
  const raw = await readManifest(path, name);
  const dataset = Dataset.fromObject(raw);
  const cases = await Promise.all(dataset.cases.map((entry, index) => toCase(entry, index, name, root)));
  return { name, cases };
}

function readManifest(path: string, name: string): Promise<unknown> {
  return readFile(path, 'utf8').then((text) => JSON.parse(text) as unknown, (error: unknown) => {
    if (isMissing(error)) throw new RangeError(`no prefix corpus named "${name}" at ${path}`);
    throw error;
  });
}

async function toCase(entry: CaseLike, index: number, name: string, root: string): Promise<PrefixCase> {
  const where = `${name} case ${String(index)}`;
  const caseName = requireName(entry.name, where);
  const inputs = parseAt(PrefixCaseInput, entry.inputs, `${name}: ${caseName}.inputs`);
  const metadata = parseAt(PrefixCaseMetadata, entry.metadata, `${name}: ${caseName}.metadata`);
  const sourcePath = join(root, name, inputs.prefix.file);
  if (!(await exists(sourcePath))) throw new PrefixEvidenceMissingError(`${name}: ${caseName}`, sourcePath);
  return { name: caseName, inputs, metadata, sourcePath };
}

interface CaseLike {
  readonly name?: string;
  readonly inputs?: unknown;
  readonly metadata?: unknown;
}

function requireName(name: string | undefined, where: string): string {
  if (name === undefined || name.trim() === '') throw new TypeError(`${where}: a case needs a name`);
  return name;
}

function parseAt<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TypeError(`${where}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
