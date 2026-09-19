/**
 * `pg`, as the workerd pool sees it.
 *
 * `@prisma/orm-postgres/serverless` imports `Client` from `pg`, and `pg` ships
 * CommonJS. The pool runs workerd with the CJS→ESM shim disabled
 * (`mf_vitest_no_cjs_esm_shim`), so Vite refuses `pg/lib/index.js` outright and
 * any module that reaches it cannot load — which would take the whole Worker
 * pool with it. `vitest.config.ts` therefore aliases `pg` (and `pg-cursor`, the
 * driver's optional cursor module) to this file for the pool only; the Node
 * integration arm resolves the real ones, because that is the arm with a socket.
 *
 * The pool never opens a TCP connection, so nothing here has to WORK — it has to
 * LOAD. Every construction and every type-parser touch fails with the reason, so
 * a pool test that accidentally needs a live driver reads as one instead of
 * silently passing.
 */

const UNAVAILABLE =
  "pg is not available in the workerd pool (no TCP, no CJS shim): the Postgres arms are the Node integration suite";

/** A constructible stand-in whose every use names what is missing. */
function refuse(what: string): () => never {
  return function refused(): never {
    throw new Error(`${what}: ${UNAVAILABLE}`);
  };
}

export const Client = refuse("pg.Client");
export const Pool = refuse("pg.Pool");

/** The `pg-cursor` default export: the driver's cursor path, likewise absent. */
export default refuse("pg-cursor");

export const types = {
  getTypeParser: refuse("pg types.getTypeParser"),
  arrayParser: { create: refuse("pg types.arrayParser.create") },
};
