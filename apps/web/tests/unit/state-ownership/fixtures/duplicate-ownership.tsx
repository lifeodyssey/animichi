/**
 * AC6 reviewer fixture — the duplicate-ownership anti-pattern, on purpose.
 *
 * One fact — `q` (the selected query, carried by the real `/chat` route search
 * as `?q=`) — is represented simultaneously in every ownership channel the
 * ticket recognises:
 *   - URL: `useSearch()` (a router search binding);
 *   - Query cache: `useQuery()` (server state);
 *   - Context: `useContext(FactContext)` (feature capability);
 *   - local state: `useState(q)` — a copy of the URL value, the AC4/AC6
 *     "second local authority".
 *
 * `tests/unit/state-ownership/architecture.test.ts` runs the checker over this
 * file and asserts the fact is detected on all four channels. The fixture is
 * never executed by the suite — it is parsed source, type-checked by `tsc`
 * and linted by oxlint like any other `tests/` file, so it stays reviewer
 * bait that compiles.
 */

import { createContext, useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";

const FactContext = createContext<{ readonly q?: string } | undefined>(undefined);

export function useDuplicateOwnershipFixture() {
  const url = useSearch({ strict: false });
  const query = useQuery({
    queryKey: ["fact"],
    queryFn: () => Promise.resolve({ q: "x" }),
  });
  const context = useContext(FactContext);
  const q = url.q;
  const queryQ = query.data?.q;
  const contextQ = context?.q;
  const [localQ, setLocalQ] = useState(q);
  return { q, queryQ, contextQ, localQ, setLocalQ };
}
