import { ItineraryDraft } from "../../src/features/chat/components/ItineraryDraft";
import type { ItineraryDraftProps } from "../../src/features/chat/components/ItineraryDraft";

export function ItineraryDraftPreview(props: ItineraryDraftProps) {
  return <div style={{ width: "min(480px, calc(100vw - 80px))", maxWidth: "100%" }}><ItineraryDraft {...props} /></div>;
}
