/**
 * The shared contract as the plan repairs in `./plans` read it: `planFromAst` takes the
 * contract's target and storage hash for each plan it hands back.
 *
 * `./plans` cannot import the contract from `./prisma`, which builds it: `./prisma` loads on the
 * first request that needs it (`./prisma-first-use`), and a static value import of it would bring
 * Prisma's evaluation back into the Worker's startup. `./prisma` records the contract here as it
 * evaluates instead, and a plan to repair only ever comes from a builder `./prisma` made.
 */
import type { Contract } from "@animichi/pi-session-neon/types";

let recorded: Contract | undefined;

/** Record the contract `./prisma` built, and hand it back. */
export function recordPlanContract(contract: Contract): Contract {
  recorded = contract;
  return contract;
}

/** The recorded contract. A repair before `./prisma` has evaluated is a bug, and says so. */
export function planContract(): Contract {
  if (recorded === undefined) throw new Error("plan repair before the catalog's Prisma access loaded: no contract");
  return recorded;
}
