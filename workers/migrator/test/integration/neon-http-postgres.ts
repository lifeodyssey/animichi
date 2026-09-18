/**
 * A real PostgreSQL behind the Neon HTTP boundary. Only the HTTP transport is replaced: the
 * native driver generates the payload, and `pg` executes each query on the disposable server
 * with the modes the headers declare. The migration path no longer speaks Neon HTTP at all
 * (#1634) — `/catalog-schema`'s read-only probe is what still does.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { expect, vi } from "vitest";

interface NeonBatch {
  queries: { query: string; params: string[] }[];
}

export function servePostgres(dsn: string) {
  const captures: { readOnly: string | null; isolation: string | null; batch: NeonBatch }[] = [];
  const transport = vi.fn<typeof fetch>(async (_input, options) => {
    const headers = new Headers(options?.headers);
    expect(headers.get("Neon-Connection-String")).toBe(dsn);
    expect(typeof options?.body).toBe("string");
    const batch = JSON.parse(options?.body as string) as NeonBatch;
    captures.push({ readOnly: headers.get("Neon-Batch-Read-Only"), isolation: headers.get("Neon-Batch-Isolation-Level"), batch });
    expect(headers.get("Neon-Batch-Read-Only")).toBe("true");
    expect(headers.get("Neon-Batch-Isolation-Level")).toBe("RepeatableRead");
    return executeBatch(dsn, batch);
  });
  vi.stubGlobal("fetch", transport);
  return { transport, captures };
}

async function executeBatch(dsn: string, batch: NeonBatch): Promise<Response> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const results = [];
    for (const { query, params } of batch.queries) {
      results.push(await client.query<unknown[]>({ text: query, values: params, rowMode: "array" }));
    }
    await client.query("COMMIT");
    return Response.json({ results });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof pg.DatabaseError) return Response.json({ code: error.code, message: error.message }, { status: 400 });
    throw error;
  } finally {
    await client.end();
  }
}

/** Durable evidence for the runbook, written only when a run asks for a directory. */
export async function saveEvidence(name: string, evidence: unknown): Promise<void> {
  const directory = process.env.PREFLIGHT_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), JSON.stringify(evidence, null, 2) + "\n");
}
