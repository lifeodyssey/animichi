/** `/chat` A2 navigation target: reuses S1.1's `?q=` entry-point (spec S5.5). */
export interface ChatSearchTarget {
  readonly to: "/chat";
  readonly search: { readonly q: string };
}

export function chatSearchTarget(query: string): ChatSearchTarget | null {
  const q = query.trim();
  return q ? { to: "/chat", search: { q } } : null;
}

/** Path form of the A2 target, for carriers that take a URL string instead of a
 * router target — the landing return-target, which rides the magic link as
 * `?next=` and is re-validated by `sanitizeReturnTarget` on the way back. */
export function chatSearchPath(query: string): string | undefined {
  const target = chatSearchTarget(query);
  return target ? `${target.to}?q=${encodeURIComponent(target.search.q)}` : undefined;
}

export type NavigateFn = (target: ChatSearchTarget) => void;

export function makeSearchHandler(navigate: NavigateFn): (query: string) => void {
  return (query) => {
    const target = chatSearchTarget(query);
    if (target) navigate(target);
  };
}
