/** The one-at-a-time turn in which a caller creates the service roles and applies
 * the Prisma chain (#1663).
 *
 * Two cluster-global writes are not safe to run twice at once. `CREATE ROLE` is
 * check-then-create (`service-roles.ts`), so two callers that reach it together
 * both read an empty `pg_roles` and the second one to commit dies on
 * `pg_authid_rolname_index`; and the chain's grant matrix prechecks those same
 * rows, so an apply ordered before the creation that would satisfy it fails its
 * precheck instead. A container per suite made both impossible; on the shared
 * one (#1663) every arm in every worktree on this host writes beside the
 * others, and the observed failure is CI's edge lane.
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
export const CHAIN_APPLY_LOCK_KEY = 1663;

export class ChainApplyTurn {
  #adminDsn: string;

  constructor(adminDsn: string) {
    this.#adminDsn = adminDsn;
  }

  /** Run `apply` as the cluster's only chain applier, releasing the turn after
   * and passing `apply`'s own value through.
   *
   * Released in `finally` by ending the session that holds it — a SESSION-level
   * advisory lock dies with its session, so a caller that fails, or is killed,
   * cannot strand the cluster behind a lock nobody is left to unlock. */
  async hold<Result>(apply: () => Promise<Result>): Promise<Result> {
    const turn = new pg.Client(this.#adminDsn);
    await turn.connect();
    try {
      await turn.query("select pg_advisory_lock($1)", [CHAIN_APPLY_LOCK_KEY]);
      return await apply();
    } finally {
      await turn.end();
    }
  }
}
