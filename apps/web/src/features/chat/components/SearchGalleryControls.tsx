import { Button } from "animal-island-ui-tailwind/button";
import { useOptionalChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import type { SearchSpot } from "../lib/spot-clusters";
import { useSpotSelection } from "../selection/use-spot-selection";
import { animalButtonClass } from "./AnimalButton";

type FooterProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict }>;

export function GalleryHeader({ dict, galleryId }: Readonly<{ dict: ChatDict; galleryId: string }>) {
  return <header className="grid gap-1"><h4 id={`${galleryId}-title`} className="text-lg font-bold leading-snug text-fg">{dict.search.browseTitle}</h4><p className="text-sm leading-relaxed text-muted-fg">{dict.search.browseHint}</p></header>;
}

/** A regular conversational turn; this does not silently select every candidate. */
function ArrangeButton({ spots, dict }: FooterProps) {
  const actions = useOptionalChatActions();
  if (!actions) return null;
  const places = spots.map((spot) => [spot.name, spot.city].filter(Boolean).join(" · ")).join("、");
  return <footer className="flex pt-1"><Button htmlType="button" type="primary" disabled={actions.disabled} onClick={() => { actions.send(dict.search.arrangePrompt.replace("{places}", places)); }} className={animalButtonClass({ tone: "gold", className: "grow @min-[24rem]:grow-0 @min-[24rem]:min-w-44 disabled:opacity-60" })}>{dict.search.arrange}</Button></footer>;
}

export function GalleryFooter(props: FooterProps) {
  const { selected } = useSpotSelection();
  if (selected.size > 0) return null;
  return <ArrangeButton {...props} />;
}
