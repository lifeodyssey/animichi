import { TURNSTILE_HEADER, TURNSTILE_VERIFY_PATH } from "@animichi/contract/constants";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import { useAuthStatus } from "../../lib/auth/session";
import { clearTurnstileToken, rememberTurnstileToken } from "../../lib/turnstile/token-store";
import { currentChatConfig } from "./config";
import { TurnstileGate, configuredTurnstileSiteKey, resetTurnstileWidget } from "./components/TurnstileGate";
import { chatDictFor } from "./i18n";
import type { ChatDict } from "./i18n";

type GatePhase = "challenge" | "verifying" | "failed" | "passed";

async function verifyToken(baseUrl: string, token: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}${TURNSTILE_VERIFY_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: { [TURNSTILE_HEADER]: token },
  });
  return response.ok;
}

function useInvalidation(
  siteKey: string | undefined, attempt: RefObject<number>, setPhase: (phase: GatePhase) => void,
) {
  return useCallback(() => {
    attempt.current += 1;
    clearTurnstileToken();
    setPhase(siteKey === undefined ? "failed" : "challenge");
  }, [attempt, setPhase, siteKey]);
}

function failAttempt(
  current: number, attempt: RefObject<number>, setPhase: (phase: GatePhase) => void,
): void {
  if (current !== attempt.current) return;
  clearTurnstileToken();
  setPhase("failed");
}

async function settleAttempt(baseUrl: string, token: string, current: number, attempt: RefObject<number>, setPhase: (phase: GatePhase) => void): Promise<void> {
  try {
    const ok = await verifyToken(baseUrl, token);
    if (current !== attempt.current) return;
    if (!ok) clearTurnstileToken();
    setPhase(ok ? "passed" : "failed");
  } catch { failAttempt(current, attempt, setPhase); }
}

function useSolve(
  baseUrl: string, attempt: RefObject<number>, setPhase: (phase: GatePhase) => void,
) {
  return useCallback((token: string) => {
    const current = ++attempt.current;
    rememberTurnstileToken(token);
    setPhase("verifying");
    void settleAttempt(baseUrl, token, current, attempt, setPhase);
  }, [attempt, baseUrl, setPhase]);
}

function useVerification(baseUrl: string, siteKey: string | undefined) {
  const [phase, setPhase] = useState<GatePhase>(siteKey === undefined ? "failed" : "challenge");
  const attempt = useRef(0);
  const invalidate = useInvalidation(siteKey, attempt, setPhase);
  const solve = useSolve(baseUrl, attempt, setPhase);
  return { phase, invalidate, solve };
}

function RetryOnly({ label, failed, retry }: Readonly<{ label: string; failed: string; retry: string }>) {
  return <section className="turnstile-entry__card" aria-label={label}>
    <h1>{label}</h1>
    <p role="alert">{failed}</p>
    <button type="button" className="turnstile-gate__retry" onClick={() => { window.location.reload(); }}>{retry}</button>
  </section>;
}

function PendingGate({ label }: Readonly<{ label: string }>) {
  return <div className="turnstile-entry" role="status" aria-live="polite"><p>{label}</p></div>;
}

function useEntryConfig() {
  const siteKey = useMemo(() => configuredTurnstileSiteKey(), []);
  const baseUrl = useMemo(() => currentChatConfig().baseUrl, []);
  return { siteKey, baseUrl };
}

function useRestart(invalidate: () => void): () => void {
  return useCallback(() => { invalidate(); resetTurnstileWidget(); }, [invalidate]);
}

type AnonymousProps = Readonly<{
  dict: ChatDict; siteKey: string | undefined;
  phase: GatePhase; retry: () => void; solve: (token: string) => void; children: ReactNode;
}>;

function GateOverlay({ dict, siteKey, phase, retry, solve }: Omit<AnonymousProps, "children">) {
  const active = phase !== "passed";
  if (siteKey === undefined) return <div className="turnstile-entry"><RetryOnly {...dict.turnstile} /></div>;
  return <div className="turnstile-entry" data-active={String(active)} aria-busy={phase === "verifying"}>
    <TurnstileGate dict={dict} siteKey={siteKey} failed={phase === "failed"}
      onRetry={retry} onToken={solve} onInvalid={retry} />
  </div>;
}

function AnonymousEntry(props: AnonymousProps) {
  if (props.phase === "passed") return props.children;
  return <GateOverlay {...props} />;
}

function AnonymousGate({ dict, children }: Readonly<{ dict: ChatDict; children: ReactNode }>) {
  const { siteKey, baseUrl } = useEntryConfig();
  const gate = useVerification(baseUrl, siteKey);
  const retry = useRestart(gate.invalidate);
  return <AnonymousEntry dict={dict} siteKey={siteKey} phase={gate.phase}
    retry={retry} solve={gate.solve}>{children}</AnonymousEntry>;
}

export function ChatEntryGate({ children }: Readonly<{ children: ReactNode }>) {
  const auth = useAuthStatus();
  const dict = chatDictFor(useLocale());
  if (auth === "pending") return <PendingGate label={dict.turnstile.label} />;
  if (auth === "authenticated") return children;
  return <AnonymousGate dict={dict}>{children}</AnonymousGate>;
}
