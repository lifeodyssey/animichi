import { completedTotals } from "../../lib/route-detail/dataState";
import type { RouteDataState, RouteDetail } from "../../lib/route-detail/dataState";
import type { RouteDetailCopy } from "../../lib/route-detail/copy";

/**
 * Route detail hero (spec-route-detail §1). The completed state lights up a
 * 完走 badge (完走 N/total ✓); every other state keeps the hero chrome minimal.
 */
interface HeroProps {
  readonly detail: RouteDetail;
  readonly state: RouteDataState;
  readonly copy: RouteDetailCopy;
}

function CompletedBadge({ detail, copy }: Omit<HeroProps, "state">) {
  const { done, total } = completedTotals(detail);
  return (
    <p className="m-0 inline-flex items-center gap-1 rounded-full bg-[var(--color-focus)] px-3 py-1 font-bold text-[var(--color-fg)]">
      {copy.completedBadge(done, total)}
    </p>
  );
}

export function Hero({ detail, state, copy }: HeroProps) {
  return (
    <header className="flex flex-col gap-3 rounded-2xl bg-[var(--color-card)] p-5">
      <h1 className="m-0 text-2xl font-bold text-[var(--color-fg)]">{detail.title}</h1>
      {state === "completed" ? <CompletedBadge detail={detail} copy={copy} /> : null}
    </header>
  );
}
