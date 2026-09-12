import { useState } from "react";
import { RecentConversations } from "../../src/features/chat/components/RecentConversations";
import type { RecentConversationsProps } from "../../src/features/chat/components/RecentConversations";

/** Preview clicks update selection only; retry waits for an explicit story outcome. */
export function RecentConversationsPreview(props: RecentConversationsProps) {
  const [activeSessionId, setActiveSessionId] = useState(props.activeSessionId), [status, setStatus] = useState(props.status);
  const onOpen = (id: string) => { props.onOpen?.(id); setActiveSessionId(id); };
  const onRetry = () => { props.onRetry(); setStatus("loading"); };
  return <div style={{ width: "min(292px, calc(100vw - 80px))", maxWidth: "100%" }}><RecentConversations {...props} status={status} activeSessionId={activeSessionId} onOpen={onOpen} onRetry={onRetry} /></div>;
}
