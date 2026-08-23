import { useDict } from "../../i18n/LocaleProvider";
import type { Dict } from "../../i18n/dictionaries";

/**
 * The indexable body of `/` (owner 2026-08-23).
 *
 * `/` is a doorway: the client hands every human visitor to `/chat` on the
 * first effect, under a splash that only lifts once chat paints. Nobody reads
 * this — but a crawler, a share-preview fetcher and a text-mode browser all
 * take the SERVED HTML and stop there, so an empty body would hand them a
 * title tag with nothing behind it. This is the minimum that is still a real
 * page: the name, one sentence of what the site does, and the links a crawler
 * needs to walk further.
 *
 * The copy is the existing three-language dictionary — no second string set
 * for a surface humans never see.
 */
const REPO_URL = "https://github.com/lifeodyssey/animichi";

function DoorwayLinks({ doorway }: Readonly<{ doorway: Dict["doorway"] }>) {
  return (
    <nav className="doorway__links" aria-label={doorway.links}>
      <a className="doorway__link" href="/chat">{doorway.cta}</a>
      <a className="doorway__link" href="/privacy">{doorway.privacy}</a>
      <a className="doorway__link" href={REPO_URL} target="_blank" rel="noreferrer">{doorway.github}</a>
    </nav>
  );
}

export function DoorwaySummary() {
  const doorway = useDict().doorway;
  return (
    <main className="doorway">
      <h1 className="doorway__title">{doorway.hero}</h1>
      <p className="doorway__lead">{doorway.lead}</p>
      <DoorwayLinks doorway={doorway} />
    </main>
  );
}
