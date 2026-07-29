import { useCallback, useState } from "react";

/**
 * Shared plumbing for the BYOK discovery journey (issue #284 Task 8): every
 * touchpoint (D11 secondary affordance, settings teaser, `byok_requires_login`
 * rejection) funnels login through the same validated deep-link target, so the
 * magic link lands the user back on the chat route with the panel open — in
 * whatever tab the link opens in.
 */
export const BYOK_SETUP_TARGET = "/chat?settings=byok";

export interface LoginDisclosure {
  readonly open: boolean;
  readonly show: () => void;
  readonly hide: () => void;
}

export function useLoginDisclosure(): LoginDisclosure {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => { setOpen(true); }, []);
  const hide = useCallback(() => { setOpen(false); }, []);
  return { open, show, hide };
}
