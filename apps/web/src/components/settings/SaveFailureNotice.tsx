import { useEffect, useState } from "react";
import { useDict } from "../../i18n/LocaleProvider";
import { consumeSaveFailureNotice } from "../../lib/auth/save-failure-notice";

/** The status strip itself, kept out of the hook so both stay within limits. */
function NoticeBody({ text }: Readonly<{ text: string }>) {
  return (
    <div className="mx-auto w-[min(100%,72rem)] pt-8">
      <p role="status" className="rounded-[14px] border-2 border-warning-fg bg-gold-soft px-4 py-2.5 text-sm font-medium text-fg">
        {text}
      </p>
    </div>
  );
}

/**
 * The one-time "route didn't save" status the auth callback arms before it
 * returns a visitor to the BYOK deep link (#482 residual 2). It is consumed on
 * mount and cleared, so a reload never resurrects it. `role="status"`, not
 * `alert`: the login succeeded, only the deferred save did not.
 */
export function SaveFailureNotice() {
  const auth = useDict().auth;
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (consumeSaveFailureNotice()) setVisible(true); }, []);
  if (!visible) return null;
  return <NoticeBody text={auth.callback_save_failed} />;
}
