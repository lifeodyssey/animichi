import { Pill } from "@/components/ui/pill";

interface RouteTagProps {
  /** Route attribute label, e.g. "school" / "river". */
  label: string;
}

/**
 * RouteTag — a single route-attribute chip shown under a popular-route card
 * (e.g. "school", "river"). Thin wrapper over the design-system `Pill`
 * metadata `tag` register.
 */
export default function RouteTag({ label }: RouteTagProps) {
  return <Pill variant="tag">{label}</Pill>;
}
