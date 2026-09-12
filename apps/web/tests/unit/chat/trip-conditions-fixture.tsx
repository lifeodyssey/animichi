import { useState } from "react";
import { TripConditions } from "../../../src/features/chat/components/TripConditions";
import type { TripConditionsProps } from "../../../src/features/chat/components/TripConditions";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { emptyTravelConditions } from "../../../src/features/chat/lib/trip-conditions";

export function ConditionsFixture(props: Partial<TripConditionsProps>) {
  const [value, setValue] = useState(props.value ?? emptyTravelConditions);
  return <TripConditions dict={chatDictFor("zh")} onContinue={() => undefined} {...props} value={value} onChange={setValue} />;
}
