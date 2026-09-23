import { before, beforeEach } from "node:test";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { laneClient } from "./lane-contract-database.ts";

export let db: PostgresClient<Contract>;
export const SESSION = "settlement-session";

before(async () => { db = await laneClient(); });

beforeEach(async () => {
  await db.orm.public.PiSession.where((row) => row.id.in([SESSION, "other-session"])).deleteAll();
  await db.runtime().execute(db.raw.sql`DELETE FROM daily_usage`.affectedCount().build());
  await db.runtime().execute(db.raw.sql`DELETE FROM anon_daily_message_count`.affectedCount().build());
  await session(SESSION);
});

export function session(id: string) {
  return db.orm.public.PiSession.create({ id, metadata: { id, createdAt: 1, storageVersion: 1 } });
}
