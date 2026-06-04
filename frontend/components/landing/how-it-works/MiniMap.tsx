import RouteLine from "@/components/landing/decor/RouteLine";

/** Dashed walking-route preview for the "route" step. */
export default function MiniMap() {
  return (
    <div className="relative h-20 overflow-hidden rounded-[12px] border border-border bg-walk-bg/50">
      <div className="absolute inset-x-2 top-1/2 -translate-y-1/2">
        <RouteLine stops={1} />
      </div>
    </div>
  );
}
