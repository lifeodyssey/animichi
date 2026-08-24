import { useDict } from "../../i18n/LocaleProvider";
import type { Dict } from "../../i18n/dictionaries";

/**
 * The indexable body of `/` (owner 2026-08-23).
 *
 * `/` is a responsive doorway: mobile hands off to `/chat` on the first effect,
 * while desktop visitors stay here and activate the CTA themselves. Crawlers,
 * share-preview fetchers and text-mode browsers also take the served HTML, so
 * this remains a real page: the name, one sentence, and walkable links.
 *
 * The copy is the existing three-language dictionary.
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
