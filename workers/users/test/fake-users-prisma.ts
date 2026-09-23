/**
 * Doubles for the users query layer's Prisma seam (#1632).
 *
 * The BUILDER is the real one (`usersClient().sql`). Building a plan is pure —
 * it binds no connection, reads no row and touches no runtime — and using the
 * real builder is what keeps a double from drifting away from the contract the
 * production plan is built from: a column the contract does not declare fails
 * here exactly as it would in the Worker.
 *
 * The EXECUTOR is what a test replaces, and it is an in-memory data plane: it
 * reads the plan's AST (which carries each bound `ParamRef`'s value), evaluates
 * the WHERE tree against the rows it holds, applies the write and projects the
 * `returning(...)` list. That is what makes `rowCount`, "exactly one statement"
 * and "scoped to the owning user" assertions still mean something now that no
 * SQL text exists to capture — and it is strictly more honest than the old
 * fake, which matched rendered SQL by substring.
 *
 * This module is the double's public surface: the handle a test drives, the
 * options it stages through, and the recorder that orders the hook against the
 * statement it guards. The parts it is assembled from live beside it in
 * `fakes/` — the two row shapes and the ledger key, the reader for a built
 * plan's AST, and the in-memory tables the statements run against (including
 * what that data plane refuses to model).
 */
import type { AnyQueryAst } from "@prisma/orm-postgres/relational-core/ast";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import { usersClient, type UsersPlanExecutor, type UsersPrisma } from "../src/db/prisma";
import {
  executePlan, restoreTables, snapshotTables, usersTables,
  type FakeUsersTables, type UniqueViolation,
} from "./fakes/fake-users-data-plane";
import type { FakeLedgerRow, FakeSavedRouteRow } from "./fakes/fake-users-rows";
import { describePlan, planAst, type RecordedPlan } from "./fakes/prisma-plan-ast";

export { ledgerKey } from "./fakes/fake-users-rows";
export type { FakeLedgerRow, FakeSavedRouteRow } from "./fakes/fake-users-rows";
export type { RecordedPlan } from "./fakes/prisma-plan-ast";

export interface FakeUsersPrisma {
  readonly prisma: UsersPrisma;
  readonly rows: FakeSavedRouteRow[];
  readonly idemRows: Map<string, FakeLedgerRow>;
  readonly queries: RecordedPlan[];
}

/** A test's hook over the statement at `index` (0-based), with every plan the
 * executor has been asked for so far. */
type BeforePlan = (index: number, queries: readonly RecordedPlan[]) => void;

export interface FakeUsersPrismaOptions {
  /**
   * Run before the plan at `index` (0-based) executes. This is how a test stages
   * a race between two statements — e.g. dropping the row between an ownership
   * read and the guarded write it authorises.
   */
  readonly beforePlan?: BeforePlan;
  /**
   * Answer the plan with no rows, after applying it — a statement whose
   * `RETURNING` came back empty, the shape a `BEFORE INSERT` trigger suppressing
   * a row leaves behind. That empty answer is what the adapters' `row ===
   * undefined` guards exist for, and no plan the fake models produces it by
   * itself.
   */
  readonly emptyReturning?: (plan: RecordedPlan) => boolean;
  /**
   * The failure a duplicate composite key raises, as this data plane's driver
   * reports it. The default is the shape the runtime hands application code —
   * `FakeUniqueViolation`, carrying `sqlState` and `table` — and the option is
   * how a test stages the shapes a raw-SQL path or a wrapped runtime failure
   * leaves behind instead.
   */
  readonly uniqueViolation?: UniqueViolation;
}

/**
 * Record the statement the executor was asked for, then fire the hook at the
 * record's own index.
 *
 * The record comes FIRST. A hook that throws therefore leaves its statement
 * counted and the next statement's hook fires at the NEXT index; tied to a
 * recording that happened after the hook, the index would stay put and the
 * follow-up statement would be refused with the same failure all over again.
 */
function recordStatement(ast: AnyQueryAst, queries: RecordedPlan[], beforePlan: BeforePlan | undefined): RecordedPlan {
  const recorded = describePlan(ast);
  queries.push(recorded);
  beforePlan?.(queries.length - 1, queries);
  return recorded;
}

/** The one execution call a test drives: record, fire the hook, run the
 * statement, and answer with what `emptyReturning` says about it. */
function runRecordedPlan<Row>(
  plan: SqlOrmPlan<Row>, tables: FakeUsersTables, queries: RecordedPlan[], options: FakeUsersPrismaOptions,
): PromiseLike<readonly Row[]> {
  const ast = planAst(plan);
  const recorded = recordStatement(ast, queries, options.beforePlan);
  const rows = executePlan(ast, tables, options.uniqueViolation) as readonly Row[];
  return Promise.resolve(options.emptyReturning?.(recorded) === true ? [] : rows);
}

/** The transaction scope over `executor`: both tables roll back on a throw. */
function transactionOver(tables: FakeUsersTables, executor: UsersPlanExecutor) {
  return async <R>(fn: (tx: UsersPlanExecutor) => Promise<R>): Promise<R> => {
    const snapshot = snapshotTables(tables);
    try {
      return await fn(executor);
    } catch (error) {
      restoreTables(tables, snapshot);
      throw error;
    }
  };
}

/** Build an in-memory Prisma seam seeded with `seed`. */
export function fakeUsersPrisma(seed: FakeSavedRouteRow[] = [], options: FakeUsersPrismaOptions = {}): FakeUsersPrisma {
  const tables = usersTables(seed);
  const queries: RecordedPlan[] = [];
  const executor: UsersPlanExecutor = { query: <Row>(plan: SqlOrmPlan<Row>) => runRecordedPlan(plan, tables, queries, options) };
  return {
    prisma: { builder: usersClient().sql, executor, transaction: transactionOver(tables, executor) },
    rows: tables.routes,
    idemRows: tables.ledger,
    queries,
  };
}

/** No plan may reach this seam; for tests that must not touch Prisma at all.
 * The refusal is a rejection at the execution seam — the same place and the same
 * async shape a real driver failure arrives in — so a test asserting that a
 * persistence failure propagates is asserting the production path. */
export function unreachableUsersPrisma(): UsersPrisma {
  const refuse = (): Promise<never> => Promise.reject(new Error("the Prisma seam should not be reached"));
  return { builder: usersClient().sql, executor: { query: refuse }, transaction: refuse };
}
