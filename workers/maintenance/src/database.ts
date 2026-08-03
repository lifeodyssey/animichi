import { neon } from "@neondatabase/serverless";

export type QueryRow = Readonly<Record<string, unknown>>;

export interface QueryResult {
  readonly rowCount: number;
  readonly rows: readonly QueryRow[];
}

export interface DatabaseClient {
  query: (sql: string, parameters: readonly unknown[]) => Promise<QueryResult>;
}

/** Create a stateless Neon HTTP client for one scheduled invocation. */
export function connectDatabase(connectionString: string): DatabaseClient {
  const sql = neon(connectionString, { fullResults: true });
  return {
    async query(query, parameters) {
      const result = await sql.query(query, [...parameters]);
      return { rowCount: result.rowCount, rows: result.rows };
    },
  };
}
