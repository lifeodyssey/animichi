// FORBIDDEN: sql.raw() outside the sanctioned expressions seam.
import { sql } from "drizzle-orm";
// ruleid: ts-no-sql-raw
const alias = sql.raw("anime");
