/** The one-at-a-time turn in which a caller applies the Atlas chain (#1663).
 *
 * The chain is not safe to apply twice at once: the role block of
 * `20260826000001_roles.sql` is CLUSTER-global and checks `pg_roles` before it
 * creates, so two applies that reach it together both read an empty catalog and
 * the second one to commit dies on `pg_authid_rolname_index`. A container per
 * suite made that impossible; on the shared one (#1663) every arm in every
 * worktree on this host applies the chain beside the others, and the observed
 * failure is CI's edge lane.
 *
 * The lock is PostgreSQL's own, so it holds across processes and worktrees, not
 * just across calls in one process. It is taken on the cluster's ADMIN database,
 * because an advisory lock is scoped to the database that issued it and the
 * admin one is what every caller of one server shares — a lock taken on a
 * suite's own database would conflict with nobody.
 */
import pg from "pg";

/** One fixed key: every chain apply on this cluster, whoever runs it, queues
 * here. The value carries no meaning; only being the same number matters. */
const CHAIN_APPLY_LOCK_KEY = 1663;

export class ChainApplyTurn {
  #adminDsn: string;

  constructor(adminDsn: string) {
    this.#adminDsn = adminDsn;
  }

  /** Run `apply` as the cluster's only chain applier, releasing the turn after.
   *
   * Released in `finally` by ending the session that holds it — a SESSION-level
   * advisory lock dies with its session, so a caller that fails, or is killed,
   * cannot strand the cluster behind a lock nobody is left to unlock. */
  async hold(apply: () => Promise<void>): Promise<void> {
    const turn = new pg.Client(this.#adminDsn);
    await turn.connect();
    try {
      await turn.query("select pg_advisory_lock($1)", [CHAIN_APPLY_LOCK_KEY]);
      await apply();
    } finally {
      await turn.end();
    }
  }
}
