/**
 * What part B's Postgres-backed workerd runners share: the spike's own database with the backend's schema, one workerd
 * over a persisted directory with the DSN bound and the outbound guard installed, RPC-style calls, waits on the event
 * log, and direct reads of the keyspace's rows from Node (the crash-point proofs).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { Miniflare } from "miniflare";
import { createDatabase, dropDatabase, withClient } from "../q2/pg-admin.ts";
import { SCHEMA } from "../q2/pg-storage/schema.ts";
import { bundle, type Bundle } from "./bundle.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, type LogLine } from "./workerd.ts";

export interface Event { readonly seq: number; readonly instance: string; readonly kind: string; readonly detail: unknown; readonly at: number }

export class PgWorkerd {
  readonly log = new WorkerdLog();
  readonly guard = new OutboundGuard();
  readonly work: string;
  readonly database: string;
  readonly dsn: string;
  readonly built: Bundle;
  readonly #durableObjects: Record<string, { readonly className: string; readonly useSQLite: true }>;
  readonly #bindings: Record<string, string>;

  private constructor(work: string, database: string, dsn: string, built: Bundle, durableObjects: Record<string, { className: string; useSQLite: true }>, bindings: Record<string, string>) {
    this.work = work;
    this.database = database;
    this.dsn = dsn;
    this.built = built;
    this.#durableObjects = durableObjects;
    this.#bindings = bindings;
  }

  /** Creates the database (from `template0`), applies the schema, bundles `entry`. */
  static async create(entry: string, database: string, durableObjects: Record<string, string>, bindings: Record<string, string> = {}, extraSchema: readonly string[] = []) {
    const work = mkdtempSync(join(tmpdir(), `pi-durable-spike-${database}-`));
    const dsn = await createDatabase(database);
    await withClient(dsn, async (client) => { for (const statement of [...SCHEMA, ...extraSchema]) await client.query(statement); }, "spike-schema");
    const built = await bundle(entry, work);
    const objects = Object.fromEntries(Object.entries(durableObjects).map(([binding, className]) => [binding, { className, useSQLite: true as const }]));
    return new PgWorkerd(work, database, dsn, built, objects, { DSN: dsn, ...bindings });
  }

  start(run: string, persist = "persist"): Miniflare {
    return startWorkerd(this.built, { run, persist: join(this.work, persist), log: this.log, guard: this.guard, durableObjects: this.#durableObjects, bindings: this.#bindings });
  }

  async call<T>(mf: Miniflare, path: string, body: unknown = {}): Promise<T> {
    const response = await mf.dispatchFetch(`https://probe.test${path}`, { method: "POST", body: JSON.stringify(body) });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`${path} answered ${String(response.status)}: ${text}`);
    return JSON.parse(text) as T;
  }

  /** The first line of `run` matching `pattern` logged at or after `since`. */
  async after(run: string, pattern: RegExp, since: number, timeoutMs: number, what: string): Promise<LogLine> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const line = this.log.lines.find((candidate) => candidate.run === run && candidate.at >= since && pattern.test(candidate.text));
      if (line) return line;
      if (Date.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Rows of one keyspace, read from Node with the spike's own client (never through the object). */
  async rows(key: string, sql: string): Promise<Record<string, unknown>[]> {
    return withClient(this.dsn, async (client) => (await client.query(sql, [key])).rows, "spike-runner");
  }

  /** Waits until no backend of `application` is connected: a killed process's session has ended (a rolled-back transaction included). */
  async backendGone(application: string, timeoutMs = 15_000): Promise<number> {
    const started = Date.now();
    for (;;) {
      const live = await withClient(this.dsn, async (client: pg.Client) => (await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1", [application])).rows[0]?.n as number, "spike-runner");
      if (live === 0) return Date.now() - started;
      if (Date.now() - started > timeoutMs) throw new Error(`${application} still has ${String(live)} backend(s) after ${String(timeoutMs)} ms`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async drop(): Promise<void> {
    await dropDatabase(this.database);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
