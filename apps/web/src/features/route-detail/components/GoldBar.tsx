/**
 * The today-state gold bar under the appbar (spec-route-detail §1). Canvas
 * geometry: a soft-gold pill on the gold line with the family's 3D press step —
 * information first, but pressable because it links into Walk Mode.
 *
 * A product-specific generative component (SD-13 catalog A4): its payload
 * carries a `schema_version` for additive-only evolution and the component is
 * partial-tolerant — a payload missing the label renders the established
 * skeleton slot rather than crashing, so a legacy Chat registry payload is safe.
 */
export interface GoldBarPayload {
  readonly schema_version: number;
  readonly label?: string;
  readonly href?: string;
}

function GoldBarSkeleton() {
  return <div role="status" aria-label="Loading" className="route-skeleton route-skeleton--bar" />;
}

export function GoldBar({ payload }: { readonly payload: GoldBarPayload }) {
  if (!payload.label) return <GoldBarSkeleton />;
  return (
    <a href={payload.href ?? "#"} className="route-goldbar">
      {payload.label}
    </a>
  );
}
