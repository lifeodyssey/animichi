// FORBIDDEN: direct neon() client construction outside the db/client.ts seam.
// ruleid: ts-no-direct-neon-seam-bypass
import { neon } from "@neondatabase/serverless";
const sql = neon("postgres://example");
// (the returned sql would be used to run raw tagged queries - already a bypass)
