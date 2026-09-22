// FORBIDDEN, form 1 of 2: the client's whole-query raw lane.
//
// Alone in its own file because the gate scans each forbidden fixture on its
// own. Sharing a file with form 2 let either finding satisfy the whole check,
// so deleting one branch of the rule left the gate green.

export async function listRows(db: any, id: string): Promise<unknown> {
  // ruleid: ts-no-prisma-raw-escape
  return await db.raw.sql`SELECT * FROM anime WHERE id = ${id}`.returnsRow({}).build();
}
