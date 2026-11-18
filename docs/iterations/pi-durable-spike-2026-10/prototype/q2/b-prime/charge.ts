/**
 * One operation's charge as settlement banks it: the usage of every model call (and every tool that reports usage) in
 * the operation's own entry range, never `usage()`'s session total. Shared by the host and the runners, which recompute
 * it from the stored rows.
 */
export interface ChargedCall { readonly entry: number; readonly role: string; readonly totalTokens: number; readonly stopReason?: string }

export function chargeOf(entries: readonly { id: number; model?: readonly unknown[] }[]): { total: number; calls: ChargedCall[] } {
  const calls: ChargedCall[] = [];
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      const { role, usage, stopReason } = message as { role?: string; usage?: { totalTokens?: number }; stopReason?: string };
      if (usage?.totalTokens !== undefined) calls.push({ entry: entry.id, role: role ?? "", totalTokens: usage.totalTokens, ...(stopReason ? { stopReason } : {}) });
    }
  }
  return { total: calls.reduce((sum, call) => sum + call.totalTokens, 0), calls };
}
