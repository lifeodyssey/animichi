import type { AnimeOverviewCircle } from "@animichi/contract";
import { SectionHead } from "./SectionHead";
import type { AnimeCopy } from "./copy";

type Props = Readonly<{ circles: readonly AnimeOverviewCircle[]; copy: AnimeCopy }>;

function CircleItem({ circle, copy }: Readonly<{ circle: AnimeOverviewCircle; copy: AnimeCopy }>) {
  return (
    <li className="anime-area">
      <span className="anime-area__name">{circle.region}</span>
      <span className="anime-pill anime-pill--teal">{copy.spotUnit(circle.count)}</span>
    </li>
  );
}

/** Region skeleton for the bubble map card (the map itself lands in S5.2). */
export function CirclesSection({ circles, copy }: Props) {
  return (
    <section aria-labelledby="anime-areas" className="anime-section">
      <SectionHead id="anime-areas" label={copy.areasHeading} />
      <ul className="anime-card anime-areas">
        {circles.map((circle) => <CircleItem key={circle.region} circle={circle} copy={copy} />)}
      </ul>
    </section>
  );
}
