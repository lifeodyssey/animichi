import { useChatActions } from "../../chat-actions";
import type { ChatDict } from "../../i18n";

/**
 * D3: fewer than three route points. The spot cards above stay rendered;
 * this notice explains the short walk and proposes widening the search.
 */
export function ShortRouteNotice({ dict }: Readonly<{ dict: ChatDict }>) {
  const { send } = useChatActions();
  const chip = dict.errorStates.d3Chip;
  return (
    <div className="chat-short-route" data-fallback="D3">
      <p className="chat-short-route__notice">{dict.errorStates.d3Notice}</p>
      <button type="button" className="chat-chip" data-tone="primary" onClick={() => { send(chip); }}>{chip}</button>
    </div>
  );
}
