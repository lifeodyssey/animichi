import { useState } from "react";
import { HistoryList } from "../../src/features/chat/components/HistoryList";
import type { HistoryListProps } from "../../src/features/chat/components/HistoryList";

/** Explicit outcomes only: retry enters waiting; draft continuation is an Actions callback. */
export function HistoryReplayPreview(props: HistoryListProps) {
  const [status, setStatus] = useState(props.status);
  const onRetry = () => { props.onRetry?.(); setStatus("loading"); };
  return <div style={{ width: "min(620px, calc(100vw - 80px))", maxWidth: "100%" }}><HistoryList {...props} status={status} onRetry={props.onRetry ? onRetry : undefined} /></div>;
}
