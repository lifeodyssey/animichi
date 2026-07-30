import type { AnimeOverviewCircle } from "@animichi/contract";
import type { AnimeCopy } from "./copy";

type Props = Readonly<{ circles: readonly AnimeOverviewCircle[]; copy: AnimeCopy }>;

function CircleItem({ circle, copy }: Readonly<{ circle: AnimeOverviewCircle; copy: AnimeCopy }>) {
  return (
    <li className="flex items-center justify-between rounded-xl bg-[var(--color-card)] px-3 py-2">
      <span className="font-bold">{circle.region}</span>
      <span className="text-sm text-[var(--color-muted-fg)]">{copy.spotUnit(circle.count)}</span>
    </li>
  );
}

/** Region skeleton for the bubble map card (the map itself lands in S5.2). */
export function CirclesSection({ circles, copy }: Props) {
  return (
    <section aria-labelledby="anime-areas">
      <h2 id="anime-areas" className="text-lg">{copy.areasHeading}</h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {circles.map((circle) => <CircleItem key={circle.region} circle={circle} copy={copy} />)}
      </ul>
    </section>
  );
}
