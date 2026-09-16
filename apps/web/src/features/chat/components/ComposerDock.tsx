import type { ChatDict } from "../i18n";
import { ChatInput } from "./ChatInput";

/** What the composer is allowed to do this render (spec group G): A5 and the
 * A3 history gate take the field away, a running turn only takes the send key,
 * and a failed turn owes the visitor their words back. */
export type ComposerGate = Readonly<{ locked: boolean; busy: boolean; failed: boolean }>;

type Props = Readonly<{
  dict: ChatDict;
  gate: ComposerGate;
  quotaLocked: boolean;
  onSend: (text: string) => void;
}>;

/** Mockup `.dock`: the composer region at the panel's foot — the pill, then
 * the hint line. */
const DOCK_CLASS = "px-7 pb-[var(--chat-gutter)] max-lg:px-4 max-lg:pb-4";
/** Mockup caps the composer at 860px and centers it inside the panel, like
 * the cold-start column above it. */
const STACK_CLASS = "mx-auto grid w-full max-w-[860px] gap-3";
const HINT_CLASS = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 text-sm font-medium leading-5 text-ground-ink";

function EnterGlyph() {
  return <svg className="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4v6a2 2 0 0 1-2 2H4m4-4-4 4 4 4" /></svg>;
}

function ComposerHint({ dict }: Readonly<{ dict: ChatDict }>) {
  return <div className={HINT_CLASS}><span className="[display:flex] items-center gap-1.5"><EnterGlyph />{dict.hintSend}</span></div>;
}

/** The pill and the hint line under it. */
function ComposerParts({ dict, gate, quotaLocked, onSend }: Props) {
  return <><ChatInput dict={dict} disabled={gate.locked} busy={gate.busy} quotaLocked={quotaLocked} sendFailed={gate.failed} onSend={onSend} /><ComposerHint dict={dict} /></>;
}

/** The direction-E composer: the gold send disc inside the pill and the hint
 * line under it. #1604 deleted the photo search surface, so the pill no longer
 * carries the camera key that used to sit in its left edge. */
export function ComposerDock({ dict, gate, quotaLocked, onSend }: Props) {
  return <div className={DOCK_CLASS}><div className={STACK_CLASS}><ComposerParts dict={dict} gate={gate} quotaLocked={quotaLocked} onSend={onSend} /></div></div>;
}
