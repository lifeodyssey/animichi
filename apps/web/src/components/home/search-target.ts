/** `/chat` A2 navigation target: reuses S1.1's `?q=` entry-point (spec S5.5). */
export interface ChatSearchTarget {
  readonly to: "/chat";
  readonly search: { readonly q: string };
}

export function chatSearchTarget(query: string): ChatSearchTarget | null {
  const q = query.trim();
  return q ? { to: "/chat", search: { q } } : null;
}

export type NavigateFn = (target: ChatSearchTarget) => void;

export function makeSearchHandler(navigate: NavigateFn): (query: string) => void {
  return (query) => {
    const target = chatSearchTarget(query);
    if (target) navigate(target);
  };
}
