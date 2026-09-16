import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import pg from "pg";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export const SESSION = "01992000-0000-7000-8000-000000001546";
export const IDENTITY = "anon_00000000000000000000000000001546";
export let dsn: string;
export let pool: pg.Pool;
const resources: { postgres?: TestPostgres; contract?: ContractDatabase; pool?: pg.Pool } = {};

before(async () => {
  const postgres = resources.postgres = await startTestPostgres({ database: "native_host", budget: AGENT_DB_SETUP_BUDGET });
  dsn = (resources.contract = await startContractDatabase(postgres, "native_host")).dsn;
  pool = resources.pool = new pg.Pool({ connectionString: dsn });
  await pool.query(`CREATE FUNCTION host_test_settled() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_notify('host_test_settled', NEW.operation_id); RETURN NEW; END $$;
    CREATE TRIGGER host_test_settled AFTER UPDATE ON agent_settlements FOR EACH ROW
    WHEN (OLD.settled_at IS NULL AND NEW.settled_at IS NOT NULL) EXECUTE FUNCTION host_test_settled();
    CREATE FUNCTION host_test_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_notify('host_test_terminal', NEW.key); RETURN NEW; END $$;
    CREATE TRIGGER host_test_terminal AFTER INSERT OR UPDATE ON pi_scalar_values FOR EACH ROW
    WHEN (NEW.namespace = 'pi.result') EXECUTE FUNCTION host_test_terminal()`);
});

beforeEach(async () => {
  await pool.query("TRUNCATE pi_sessions CASCADE; DELETE FROM anon_daily_message_count; DELETE FROM daily_usage");
  await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION]);
});

after(async () => {
  try { await resources.pool?.end(); }
  finally { await stopResources(); }
});

/** Order matters: the contract database is dropped through the shared server the `TestPostgres`
 * owns, so its `stop()` — which drops that server's own database — comes second. */
async function stopResources(): Promise<void> {
  try {
    await resources.contract?.stop();
  } finally {
    await resources.postgres?.stop();
  }
}
