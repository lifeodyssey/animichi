import { useState } from "react";
import { TripConditions } from "../../src/features/chat/components/TripConditions";
import type { TripConditionsProps } from "../../src/features/chat/components/TripConditions";
import type { TravelConditions } from "../../src/features/chat/lib/trip-conditions";

export function TripConditionsPreview(props: TripConditionsProps) {
  const [value, setValue] = useState(props.value);
  const onChange = (next: TravelConditions) => { setValue(next); props.onChange(next); };
  return <div style={{ width: "min(420px, calc(100vw - 80px))", maxWidth: "100%" }}><TripConditions {...props} value={value} onChange={onChange} /></div>;
}
