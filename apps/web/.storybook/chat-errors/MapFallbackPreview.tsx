import type { ComponentProps } from "react";
import { MapFallback } from "../../src/features/chat/components/ErrorStates/MapFallback";
import { StaticSpotMap } from "../../src/features/chat/components/SearchMap";
import type { ChatDict } from "../../src/features/chat/i18n";
import { attachFailedBasemap, routeStations } from "../chat-cards/fixtures";

export function MapFallbackPreview(props: ComponentProps<typeof MapFallback>) {
  return <div className="w-[min(452px,calc(100vw_-_80px))] max-w-full"><MapFallback {...props} /></div>;
}

/** The real map component's fallback branch with an explicit failing adapter fixture. */
export function FailedSearchMapPreview({ dict }: Readonly<{ dict: ChatDict }>) {
  return <div className="w-[min(452px,calc(100vw_-_80px))] max-w-full"><StaticSpotMap spots={routeStations} dict={dict} attach={attachFailedBasemap} maxPins={8} /></div>;
}
