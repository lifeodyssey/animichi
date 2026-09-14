import { Button } from "animal-island-ui-tailwind/button";
import type { ChatDict } from "../i18n";
import { chatButtonClass } from "./chat-button-classes";
import { InlineNotice } from "./ErrorStates/InlineNotice";

type Props = Readonly<{ dict: ChatDict; onRetry: () => void; message?: string }>;

/** Top error banner with retry (A5 unreachable, A3 history failure). */
export function ErrorBanner({ dict, onRetry, message }: Props) {
  const retry = <Button htmlType="button" type="primary" size="small" className={chatButtonClass({ size: "small", className: "chat-error-banner__retry" })} onClick={onRetry}>{dict.retry}</Button>;
  return (
    <InlineNotice block="chat-error-banner" tone="error" role="alert" actions={retry}>
      {message ?? dict.errorBanner}
    </InlineNotice>
  );
}
