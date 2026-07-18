import type { ChatDict } from "../i18n";

type Props = Readonly<{ dict: ChatDict; onRetry: () => void }>;

/** A5: top error banner with retry while the backend is unreachable. */
export function ErrorBanner({ dict, onRetry }: Props) {
  return (
    <div className="chat-error-banner" role="alert">
      <span>{dict.errorBanner}</span>
      <button type="button" className="chat-error-banner__retry" onClick={onRetry}>
        {dict.retry}
      </button>
    </div>
  );
}
