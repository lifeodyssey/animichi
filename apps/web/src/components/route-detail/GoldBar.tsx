/**
 * The today-state gold bar under the appbar (spec-route-detail §1). A
 * product-specific generative component (SD-13 catalog A4): its payload carries
 * a `schema_version` for additive-only evolution and the component is
 * partial-tolerant — a payload missing the label renders the established
 * skeleton slot rather than crashing, so a legacy Chat registry payload is safe.
 */
export interface GoldBarPayload {
  readonly schema_version: number;
  readonly label?: string;
  readonly href?: string;
}

function GoldBarSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="h-11 w-full animate-pulse rounded-xl bg-[var(--color-focus)]/40"
    />
  );
}

export function GoldBar({ payload }: { readonly payload: GoldBarPayload }) {
  if (!payload.label) return <GoldBarSkeleton />;
  return (
    <a href={payload.href ?? "#"}
      className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--color-focus)] px-4 font-bold text-[var(--color-fg)]">
      {payload.label}
    </a>
  );
}
