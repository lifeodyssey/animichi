import { useEffect, useRef } from "react";

interface Sent {
  current: boolean;
}

function fireOnce(sent: Sent, query: string, send: (text: string) => void): void {
  if (sent.current) return;
  sent.current = true;
  send(query);
}

/** A2: fire `?q=` exactly once as an optimistic first message (no retyping). */
export function useAutoSend(
  query: string | undefined,
  enabled: boolean,
  send: (text: string) => void,
): void {
  const sent = useRef(false);
  useEffect(() => {
    if (query && enabled) fireOnce(sent, query, send);
  }, [query, enabled, send]);
}
