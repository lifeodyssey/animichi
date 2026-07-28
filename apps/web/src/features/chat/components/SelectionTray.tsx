import { useSpotSelection } from "../selection/useSpotSelection";
import { sameIds } from "../../../lib/chat/selectedPointsBypass";
import type { ChatDict } from "../i18n";

/** The recompute turn's lifecycle as the tray sees it (issue #273 S1.7 E2). */
export type RecomputeStatus = "idle" | "busy" | "failed";

type TrayProps = Readonly<{
  dict: ChatDict;
  status: RecomputeStatus;
  /** Ids of the last recompute actually sent; hides the tray until they change. */
  lastSentIds?: readonly string[];
  onRecompute: (ids: readonly string[]) => void;
}>;

type SummaryProps = Readonly<{ dict: ChatDict; count: number; failed: boolean }>;

function traySub(dict: ChatDict, failed: boolean): string {
  return failed ? dict.search.trayFailed : dict.search.trayChanged;
}

function TraySummary({ dict, count, failed }: SummaryProps) {
  return (
    <span className="chat-selection-tray__summary">
      <span className="chat-selection-tray__sub">{traySub(dict, failed)}</span>
      <span className="chat-selection-tray__count">
        {dict.search.traySelected.replace("{count}", String(count))}
      </span>
    </span>
  );
}

/** The sticky bar hides while a recompute flies or right after one succeeded. */
function trayHidden(props: TrayProps, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0 || props.status === "busy") return true;
  return props.status !== "failed" && sameIds(selected, props.lastSentIds);
}

type ActionProps = Readonly<{ dict: ChatDict; failed: boolean; fire: () => void }>;

function TrayAction({ dict, failed, fire }: ActionProps) {
  return (
    <button type="button" className="chat-selection-tray__action" onClick={fire}>
      {failed ? dict.search.trayRetry : dict.search.trayAction}
    </button>
  );
}

/**
 * E2 sticky recompute bar (design-sync `Chat 完整状态.html` `.rebar`): summary
 * line + count on the left, the gold action on the right. A failed bypass
 * turn retries here inline — it never escalates to the full-page D-states.
 */
export function SelectionTray(props: TrayProps) {
  const { selected } = useSpotSelection();
  if (trayHidden(props, selected)) return null;
  return (
    <div className="chat-selection-tray" role="status">
      <TraySummary dict={props.dict} count={selected.size} failed={props.status === "failed"} />
      <TrayAction dict={props.dict} failed={props.status === "failed"} fire={() => { props.onRecompute([...selected]); }} />
    </div>
  );
}
