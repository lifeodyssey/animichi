import { useState } from "react";
import type { ComponentProps } from "react";
import { ChatActionsProvider } from "../../src/features/chat/ChatActions";
import { EnvelopeFallback } from "../../src/features/chat/components/ErrorStates/EnvelopeFallback";

export type EnvelopeFallbackPreviewProps = ComponentProps<typeof EnvelopeFallback> & Readonly<{
  disabled?: boolean; onSend: (text: string) => void; onRetry: () => void;
}>;
export const FALLBACK_PREVIEW_WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";

/** Callbacks stop at the pending boundary; a preview never fabricates a new answer. */
export function EnvelopeFallbackPreview(props: EnvelopeFallbackPreviewProps) {
  const [pending, setPending] = useState(false);
  const send = (text: string) => { props.onSend(text); setPending(true); };
  const regenerate = () => { props.onRetry(); setPending(true); };
  return <div className={FALLBACK_PREVIEW_WIDTH}>
    <ChatActionsProvider actions={{ send, regenerate, disabled: props.disabled === true || pending }}><EnvelopeFallback state={props.state} dict={props.dict} /></ChatActionsProvider>
  </div>;
}
