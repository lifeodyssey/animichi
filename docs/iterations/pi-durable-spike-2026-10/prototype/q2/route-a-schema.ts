/** Route (a)'s projection table: one row per completed turn, keyed by the outer session id and Pi's submission id. */
export const PROJECTION_SCHEMA: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS proj_turns (session_id text NOT NULL, seq bigint NOT NULL, operation_id text NOT NULL, record text NOT NULL, PRIMARY KEY (session_id, seq))",
];
