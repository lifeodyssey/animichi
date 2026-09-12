import { useId } from "react";
import type { ReactNode } from "react";
import { useSpotSelection } from "../selection/use-spot-selection";
import { sameIds } from "../selection/use-recompute-turn";
import type { ChatDict } from "../i18n";
import { AnimalButton } from "./AnimalButton";

/** The recompute turn's lifecycle as the tray sees it (issue #273 S1.7 E2). */
export type RecomputeStatus = "idle" | "busy" | "failed";

type TrayProps = Readonly<{
  dict: ChatDict;
  status: RecomputeStatus;
  /** Ids of the last recompute actually sent; hides the tray until they change. */
  lastSentIds?: readonly string[];
  onRecompute: (ids: readonly string[]) => void;
}>;

type SummaryProps = Readonly<{ dict: ChatDict; count: number; hint?: string; hintId: string }>;

/** Design `Chat 完整状态.html` syncRebar: below two picks the bar asks for
 * more (「2件以上選んでください」) and the action disables. */
const MIN_SELECTION = 2;

function trayHint(dict: ChatDict, count: number, failed: boolean): string | undefined {
  if (count < MIN_SELECTION) return dict.search.trayMinimum;
  return failed ? dict.search.trayFailed : undefined;
}

function TraySummary({ dict, count, hint, hintId }: SummaryProps) {
  return (
    <div className="grid min-w-0 gap-1" role="status" aria-atomic="true">
      <span className="text-base font-bold leading-6 tabular-nums">
        {dict.search.traySelected.replace("{count}", String(count))}
      </span>
      {hint ? <span id={hintId} className="text-xs font-medium leading-5 text-muted-fg">{hint}</span> : null}
    </div>
  );
}

/** The sticky bar hides while a recompute flies or right after one succeeded. */
function trayHidden(props: TrayProps, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0 || props.status === "busy") return true;
  return props.status !== "failed" && sameIds(selected, props.lastSentIds);
}

type ActionProps = Readonly<{ dict: ChatDict; failed: boolean; disabled: boolean; fire: () => void; hintId?: string }>;

const ACTION = "chat-selection-tray__action [min-height:44px]! [width:100%] @min-[17rem]/tray:[width:auto] disabled:[--animal-bg-color:var(--color-muted)] disabled:[--animal-text-color:var(--color-muted-fg)]";

function TrayAction({ dict, failed, disabled, fire, hintId }: ActionProps) {
  return (
    <AnimalButton tone="gold" className={ACTION} disabled={disabled} onClick={fire} aria-describedby={hintId}>
      {failed ? dict.search.trayRetry : dict.search.trayAction}
    </AnimalButton>
  );
}

type ContentProps = Readonly<{ dict: ChatDict; count: number; failed: boolean; fire: () => void }>;
const CONTENT = "grid [grid-template-columns:minmax(0,1fr)] items-center [gap:12px] rounded-2xl border border-border-soft bg-paper px-4 py-3 text-fg @min-[17rem]/tray:[grid-template-columns:minmax(0,1fr)_auto] @min-[17rem]/tray:[gap:16px]";

function TrayContent({ dict, count, failed, fire }: ContentProps) {
  const hint = trayHint(dict, count, failed);
  const hintId = useId();
  return (
    <div className={CONTENT}>
      <TraySummary dict={dict} count={count} hint={hint} hintId={hintId} />
      <TrayAction dict={dict} failed={failed} disabled={count < MIN_SELECTION} fire={fire} hintId={hint ? hintId : undefined} />
    </div>
  );
}

/** Shares the composer's width and gutters; only actionable states occupy the dock. */
function TrayFrame({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="chat-selection-tray px-7 pb-3 max-lg:px-4"><div className="@container/tray mx-auto w-full max-w-[860px]">{children}</div></div>;
}

export function SelectionTray(props: TrayProps) {
  const { selected } = useSpotSelection();
  if (trayHidden(props, selected)) return null;
  return (
    <TrayFrame>
      <TrayContent dict={props.dict} count={selected.size} failed={props.status === "failed"} fire={() => { props.onRecompute([...selected]); }} />
    </TrayFrame>
  );
}
