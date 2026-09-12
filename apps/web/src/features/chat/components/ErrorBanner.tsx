import type { ChatDict } from "../i18n";
import { AnimalButton } from "./AnimalButton";
import { InlineNotice } from "./ErrorStates/InlineNotice";

type Props = Readonly<{ dict: ChatDict; onRetry: () => void; message?: string }>;

/** Top error banner with retry (A5 unreachable, A3 history failure). */
export function ErrorBanner({ dict, onRetry, message }: Props) {
  const retry = <AnimalButton size="small" className="chat-error-banner__retry" onClick={onRetry}>{dict.retry}</AnimalButton>;
  return (
    <InlineNotice block="chat-error-banner" tone="error" role="alert" actions={retry}>
      {message ?? dict.errorBanner}
    </InlineNotice>
  );
}
