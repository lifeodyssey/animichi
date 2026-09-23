import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionServiceRoles, resolveRuntimePasswords, type RuntimeRolePasswords } from "../src/service-roles";
import { redactedCause } from "../src/redacted-cause";

/* What the provisioning step sends over the Neon HTTP boundary, and when it sends nothing.
 *
 * The database-side proofs live against real PostgreSQL: creation from nothing in
 * `test/integration/service-roles.from-nothing.integration.ts`, on a container of its own
 * with no role created beforehand, and the logins and the no-op second run in
 * `test/integration/service-roles.integration.ts`, the strip in
 * `test/integration/service-roles.reset.integration.ts`. This file owns the step's decisions: the
 * statements it assembles, the probe that makes a second run a no-op, the escaping of a
 * bound password, and the all-or-nothing resolution of the three Secrets Store bindings.
 */

const PASSWORDS: RuntimeRolePasswords = {
  catalogSvc: "catalog-password-1",
  usersSvc: "users-password-1",
  agentSvc: "agent-password-1",
};

const BASE_DSN = "postgresql://migrator:pw@ep-x.neon.tech/neondb";

interface CapturedBatch {
  readonly dsn: string;
  readonly statements: readonly string[];
}

/** Serve the driver's batches, capturing every statement. A probe (`SELECT 1`, the driver's
 * single-query shape) succeeds only when its Neon-Connection-String carries a role and
 * password both listed here; a DDL batch is always accepted unless `batchError` is set, in
 * which case it fails with that message — the echo a driver or a DO-block CONTEXT hands back. */
function serveNeonHttp(logins: readonly string[], batchError?: string): CapturedBatch[] {
  const batches: CapturedBatch[] = [];
  const transport = vi.fn<typeof fetch>((_input: unknown, options?: RequestInit) =>
    answerNeonHttp(logins, batches, options, batchError));
  vi.stubGlobal("fetch", transport);
  return batches;
}

function statementsOf(raw: string): readonly string[] {
  const parsed = JSON.parse(raw) as { query?: string; queries?: { query: string }[] };
  return parsed.queries?.map((query) => query.query) ?? (parsed.query === undefined ? [] : [parsed.query]);
}

function answerNeonHttp(logins: readonly string[], batches: CapturedBatch[], options: RequestInit | undefined, batchError?: string): Promise<Response> {
  const headers = new Headers(options?.headers);
  const dsn = headers.get("Neon-Connection-String") ?? "";
  const raw = options?.body;
  if (typeof raw !== "string") return Promise.reject(new Error("unexpected neon batch body"));
  const statements = statementsOf(raw);
  batches.push({ dsn, statements });
  if (statements.length === 1 && statements[0] === "SELECT 1") return probeAnswer(logins, dsn);
  if (batchError !== undefined) return Promise.resolve(Response.json({ code: "42601", message: batchError }, { status: 400 }));
  return Promise.resolve(Response.json({ results: [] }));
}

function probeAnswer(logins: readonly string[], dsn: string): Promise<Response> {
  return logins.includes(dsn)
    ? Promise.resolve(Response.json({ fields: [{ name: "?column?" }], rows: [[1]] }))
    : Promise.resolve(Response.json({ code: "28P01", message: "password authentication failed" }, { status: 400 }));
}

afterEach(() => { vi.restoreAllMocks(); });

async function provision(logins: readonly string[]): Promise<readonly string[]> {
  const batches = serveNeonHttp(logins);
  await provisionServiceRoles(BASE_DSN, PASSWORDS);
  return batches.at(-1)?.statements ?? [];
}

const roleDsn = (role: string, password: string): string =>
  `postgresql://${role}:${password}@ep-x.neon.tech/neondb`;

const allLogins = Object.entries({
  agent_svc: PASSWORDS.agentSvc, catalog_svc: PASSWORDS.catalogSvc, users_svc: PASSWORDS.usersSvc,
}).map(([role, password]) => roleDsn(role, password));

describe("the statements every run sends", () => {
  it("creates the five roles check-then-create, with jobs_svc and readonly NOLOGIN", async () => {
    const statements = await provision(allLogins);
    expect(statements.some((statement) => statement.includes("CREATE ROLE %I NOLOGIN"))).toBe(true);
    expect(statements.some((statement) => statement.includes("pg_auth_members"))).toBe(true);
    const reset = statements.find((statement) => statement.includes("rolbypassrls"));
    expect(reset).toContain("NOSUPERUSER");
    expect(reset).toContain("desired_login := role_name IN ('agent_svc', 'catalog_svc', 'users_svc')");
  });

  it("escapes a bound password as one SQL literal", async () => {
    const statements = await provisionWithPassword("abc''def'ghi");
    expect(statements).toContain("ALTER ROLE catalog_svc PASSWORD 'abc''''def''ghi'");
  });
});

async function provisionWithPassword(catalogPassword: string): Promise<readonly string[]> {
  const batches = serveNeonHttp(allLogins);
  await provisionServiceRoles(BASE_DSN, { ...PASSWORDS, catalogSvc: catalogPassword });
  return batches.at(-1)?.statements ?? [];
}

describe("the login probe", () => {
  it("sends no ALTER when every bound password lets its role in", async () => {
    const statements = await provision(allLogins);
    expect(statements.some((statement) => statement.includes("PASSWORD"))).toBe(false);
  });

  it("re-sets exactly the role the bound password does not let in", async () => {
    const drifted = allLogins.slice(1);
    const statements = await provision(drifted);
    expect(statements).toContain(`ALTER ROLE agent_svc PASSWORD '${PASSWORDS.agentSvc}'`);
    expect(statements.some((statement) => statement.includes("users_svc PASSWORD"))).toBe(false);
    expect(statements.some((statement) => statement.includes("catalog_svc PASSWORD"))).toBe(false);
  });

  it("probes the role's own credentials, never the migrator's", async () => {
    const batches = serveNeonHttp([]);
    await provisionServiceRoles(BASE_DSN, PASSWORDS);
    const probed = batches.filter(({ statements }) => statements.includes("SELECT 1")).map(({ dsn }) => dsn);
    expect(probed).toEqual(expect.arrayContaining([
      roleDsn("agent_svc", PASSWORDS.agentSvc),
      roleDsn("catalog_svc", PASSWORDS.catalogSvc),
      roleDsn("users_svc", PASSWORDS.usersSvc),
    ]));
    expect(probed).toHaveLength(3);
  });
});

describe("a forced failure whose statement carried the password", () => {
  // The proof #1915 asks for: a driver echo that hands back the failing ALTER
  // whole reaches the operator only through `redactedCause`, and the pass on
  // the CD side owns the same shape (`migrate-through-worker-redaction.test.sh`).
  it("yields a cause with no password byte once redacted", async () => {
    const echo = `syntax error in "ALTER ROLE catalog_svc PASSWORD 's3cret-probe-value'" near line 1`;
    serveNeonHttp(allLogins, echo);
    const thrown = await provisionServiceRoles(BASE_DSN, PASSWORDS).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    const cause = redactedCause(thrown);
    expect(cause).not.toContain("s3cret-probe-value");
    expect(cause).toContain("PASSWORD [redacted]");
  });
});

describe("resolving the three bound passwords", () => {
  it("passes all three through when the bindings are present", async () => {
    const resolved = await resolveRuntimePasswords({
      CATALOG_SVC_PASSWORD: "c", USERS_SVC_PASSWORD: "u", AGENT_SVC_PASSWORD: "a",
    });
    expect(resolved).toEqual({ catalogSvc: "c", usersSvc: "u", agentSvc: "a" });
  });

  it("awaits a Secrets Store binding's own get", async () => {
    const resolved = await resolveRuntimePasswords({
      CATALOG_SVC_PASSWORD: { get: () => Promise.resolve("from-the-store") },
      USERS_SVC_PASSWORD: "u", AGENT_SVC_PASSWORD: "a",
    });
    expect(resolved).toEqual({ catalogSvc: "from-the-store", usersSvc: "u", agentSvc: "a" });
  });

  it("answers none when one binding is missing", async () => {
    const resolved = await resolveRuntimePasswords({ CATALOG_SVC_PASSWORD: "c", USERS_SVC_PASSWORD: "u" });
    expect(resolved).toBeUndefined();
  });
});
