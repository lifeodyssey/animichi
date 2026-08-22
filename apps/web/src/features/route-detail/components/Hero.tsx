import { completedTotals } from "../lib/data-state";
import type { RouteDataState, RouteDetail } from "../lib/data-state";
import type { RouteDetailCopy } from "../lib/copy";

/**
 * Route detail hero (spec-route-detail §1). A canvas card (2px line, 18px
 * radius, cardPop) whose completed state lights up the gold 完走 badge pill
 * (完走 N/total ✓) in the top-right corner; every other state keeps it bare.
 */
interface HeroProps {
  readonly detail: RouteDetail;
  readonly state: RouteDataState;
  readonly copy: RouteDetailCopy;
}

function CompletedBadge({ detail, copy }: Omit<HeroProps, "state">) {
  const { done, total } = completedTotals(detail);
  return (
    <p className="route-pill route-pill--gold route-hero__badge">
      {copy.completedBadge(done, total)}
    </p>
  );
}

export function Hero({ detail, state, copy }: HeroProps) {
  return (
    <header className="route-card route-hero">
      <h1 className="route-hero__title">{detail.title}</h1>
      {state === "completed" ? <CompletedBadge detail={detail} copy={copy} /> : null}
    </header>
  );
}
