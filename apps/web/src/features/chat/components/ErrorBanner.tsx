import type { ChatDict } from "../i18n";

type Props = Readonly<{ dict: ChatDict; onRetry: () => void; message?: string }>;

/** Top error banner with retry (A5 unreachable, A3 history failure). */
export function ErrorBanner({ dict, onRetry, message }: Props) {
  return (
    <div className="chat-error-banner" role="alert">
      <span>{message ?? dict.errorBanner}</span>
      <button type="button" className="chat-error-banner__retry" onClick={onRetry}>
        {dict.retry}
      </button>
    </div>
  );
}
