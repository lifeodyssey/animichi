"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "seichi_session_id";

function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch { /* storage full or blocked */ }
}

function safeRemoveItem(key: string): void {
  try { localStorage.removeItem(key); }
  catch { /* storage blocked */ }
}

export function useSession() {
  const [sessionId, setSessionIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return safeGetItem(STORAGE_KEY);
  });

  const setSessionId = useCallback((id: string | null) => {
    setSessionIdState(id);
    if (id) {
      safeSetItem(STORAGE_KEY, id);
    } else {
      safeRemoveItem(STORAGE_KEY);
    }
  }, []);

  const clearSession = useCallback(() => {
    setSessionIdState(null);
    safeRemoveItem(STORAGE_KEY);
  }, []);

  return { sessionId, setSessionId, clearSession };
}
