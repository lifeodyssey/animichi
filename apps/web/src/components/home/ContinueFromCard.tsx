import type { UserRoute } from "@animichi/contract";
import { useContinueFrom } from "../../api/hooks/use-continue-from";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";

function ContinueCard({ route, home }: { readonly route: UserRoute; readonly home: Dict["home"] }) {
  return (
    <section aria-labelledby="continue-from-title" className="rounded-2xl bg-[var(--color-card)] p-4">
      <h2 id="continue-from-title" className="m-0 text-sm text-[var(--color-muted-fg)]">{home.continue_title}</h2>
      <p className="mt-1 mb-3 font-bold text-[var(--color-fg)]">{route.title}</p>
      <a className="inline-block rounded-xl bg-[var(--color-primary)] px-4 py-2 font-bold text-[var(--color-primary-fg)]" href={`/chat?route=${route.id}`}>{home.continue_resume}</a>
    </section>
  );
}

/** "続きから": an in-progress route resume card; renders nothing when absent
 * (logged-out, unauthorized, or no draft — spec S5.5 empty state). */
export function ContinueFromCard() {
  const home = useDict().home;
  const { route } = useContinueFrom();
  if (!route) return null;
  return <ContinueCard route={route} home={home} />;
}
