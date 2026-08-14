// FORBIDDEN: a complete SELECT via the sql tagged template.
import { sql } from "drizzle-orm";

export async function listRows(db: any): Promise<void> {
  // ruleid: ts-no-complete-sql-statement
  const rows = await db.execute(sql`SELECT * FROM anime WHERE id = ${id}`);
}
