import { useState } from "react";
import { LocationPromptView } from "../../src/features/chat/components/LocationPromptView";
import type { LocationPromptViewProps } from "../../src/features/chat/components/LocationPromptView";

export const LOCATION_PREVIEW_WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";

/** Phase fixtures only: requesting location stays pending and never reads browser GPS. */
export function LocationPromptPreview(props: LocationPromptViewProps) {
  const [state, setState] = useState(props.state);
  const onLocate = () => { props.onLocate(); setState({ phase: "pending" }); };
  const onManual = (place: string) => { props.onManual(place); setState({ phase: "sent", place }); };
  return <div className={LOCATION_PREVIEW_WIDTH}><LocationPromptView {...props} state={state} onLocate={onLocate} onManual={onManual} /></div>;
}
