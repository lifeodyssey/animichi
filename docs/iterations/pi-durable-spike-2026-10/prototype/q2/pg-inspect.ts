/**
 * Part B's first step: confirm the counting extension on the running test server before writing the control. Reads the
 * server version, `shared_preload_libraries`, the extension's version, functions, view columns and settings, from the
 * spike's own counter database (the extension is created there, never in the admin database). Writes
 * `../evidence/q2-pg-inspect.json`.
 */
import { COUNTER_DATABASE, createDatabase, withClient } from "./pg-admin.ts";
import { writeEvidence } from "../run/workerd.ts";

const dsn = await createDatabase(COUNTER_DATABASE);
const observed = await withClient(dsn, async (client) => {
  const one = async (sql: string) => (await client.query(sql)).rows;
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_stat_monitor");
  const members = (relkind: string) => one(`SELECT c.relname FROM pg_class c JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid
    JOIN pg_extension e ON d.refobjid = e.oid WHERE e.extname = 'pg_stat_monitor' AND d.deptype = 'e' AND c.relkind = '${relkind}' ORDER BY 1`);
  return {
    version: (await one("SELECT version()"))[0],
    sharedPreloadLibraries: (await one("SHOW shared_preload_libraries"))[0],
    extension: await one("SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_stat_monitor'"),
    functions: await one(`SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_depend d ON d.classid = 'pg_proc'::regclass
      AND d.objid = p.oid JOIN pg_extension e ON d.refobjid = e.oid WHERE e.extname = 'pg_stat_monitor' AND d.deptype = 'e' ORDER BY 1`),
    views: await members("v"),
    columns: (await client.query("SELECT * FROM pg_stat_monitor LIMIT 0")).fields.map((field) => field.name),
    settings: await one("SELECT name, setting, unit, short_desc FROM pg_settings WHERE name LIKE 'pg_stat_monitor.%' ORDER BY name"),
    trackUtility: await one("SELECT name, setting FROM pg_settings WHERE name IN ('track_activities', 'compute_query_id')"),
  };
});
writeEvidence("q2-pg-inspect.json", { database: COUNTER_DATABASE, ...observed });
console.log(JSON.stringify(observed, null, 2));
