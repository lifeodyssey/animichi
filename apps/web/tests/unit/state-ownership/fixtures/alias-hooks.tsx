/**
 * AC6 regression fixture — the two channel-binding forms the checker gained
 * coverage for (issue #1009 review): imported hook aliases
 * (`useQuery as useServerQuery`) and object-destructured bindings
 * (`const { data: queryQ } = ...`, `const { q } = ...`), alongside the direct
 * and array forms that must keep working.
 *
 * `tests/unit/state-ownership/architecture.test.ts` runs the checker over this
 * file and asserts the aliased and destructured bindings are all detected. The
 * fixture is never executed by the suite — it is parsed source, type-checked
 * by `tsc` and linted by oxlint like any other `tests/` file, so it stays
 * reviewer bait that compiles.
 */

import { createContext, useContext, useState } from "react";
import { useQuery as useServerQuery } from "@tanstack/react-query";
import { useSearch as useRouteSearch } from "@tanstack/react-router";

const FactContext = createContext<{ readonly q?: string } | undefined>(undefined);

const SERVER_QUERY_OPTIONS = {
  queryKey: ["fact"],
  queryFn: () => Promise.resolve({ q: "x" }),
};

export function useAliasedHooksFixture() {
  const url = useRouteSearch({ strict: false });
  const { data: queryQ } = useServerQuery(SERVER_QUERY_OPTIONS);
  const context = useContext(FactContext);
  const { q } = useRouteSearch({ strict: false });
  const urlQ = url.q, queryQValue = queryQ?.q;
  const contextQ = context?.q;
  const [localQ, setLocalQ] = useState(q);
  return { urlQ, queryQValue, contextQ, q, localQ, setLocalQ };
}
