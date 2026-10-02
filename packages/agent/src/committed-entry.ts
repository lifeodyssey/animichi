import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Entry, Session } from "@earendil-works/pi-agent-core/harness/session";

/** A ref only names a committed result in the current branch, including shared fork ancestry. */
export async function readCommittedEntry(session: Session, branchName: string, ref: string, context: Context): Promise<Entry | undefined> {
  const entry = await session.getEntry(ref, context);
  const branch = await session.branch(branchName, context);
  if (!entry || !branch || !(await branch.findEntries(undefined, context)).some((item) => item.id === ref)) return undefined;
  return entry;
}
