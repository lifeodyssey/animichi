import { useCallback, useMemo, useRef, useState } from "react";
import {
  BYOK_DEFAULT_MODEL,
  clearByokConfig,
  getByokConfig,
  getByokVisionSupported,
  saveByokConfig,
  setByokVisionSupported,
} from "../../lib/byok/byokStorage";
import type { ByokConfig, ByokProvider, ByokSaveError } from "../../lib/byok/byokStorage";
import { runByokProbe } from "./byok-probe";
import type { ByokProbeOutcome } from "./byok-probe";

/**
 * State for the BYOK settings panel (issue #284 Task 6). Saving is
 * deliberately fused with probing (OQ-2): one `/v1/byok/probe` request
 * validates the credential AND detects vision support, so configuring a key
 * costs the user exactly one probe. The raw key lives in the form state only
 * until save; after save the field is cleared and never re-filled from
 * storage, so the credential is never rendered back into the DOM.
 */

export type ByokInlineError =
  | ByokSaveError
  | "credential_rejected"
  | "unreachable"
  | "egress_blocked"
  | "invalid_request"
  | "requires_login"
  | "probe_failed";

export type ByokPhase = "idle" | "checking";

export interface ByokFormState {
  readonly provider: ByokProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
}

export interface ByokSettingsView {
  readonly form: ByokFormState;
  readonly saved: boolean;
  readonly vision: boolean | null;
  readonly phase: ByokPhase;
  readonly error: ByokInlineError | null;
  readonly setProvider: (provider: ByokProvider) => void;
  readonly setApiKey: (value: string) => void;
  readonly setModel: (value: string) => void;
  readonly setBaseUrl: (value: string) => void;
  readonly save: () => void;
  readonly clear: () => void;
}

const KNOWN_DEFAULTS = new Set<string>(Object.values(BYOK_DEFAULT_MODEL));

function defaultModelFor(provider: ByokProvider): string {
  return provider === "openai-compatible" ? "" : BYOK_DEFAULT_MODEL[provider];
}

/** OQ-1: switching family pre-fills the named default unless the user typed
 * their own model name — a hand-entered value always survives the switch. */
function modelAfterSwitch(provider: ByokProvider, current: string): string {
  const untouched = current.trim() === "" || KNOWN_DEFAULTS.has(current);
  return untouched ? defaultModelFor(provider) : current;
}

function initialForm(): ByokFormState {
  const saved = getByokConfig();
  if (saved === null) return { provider: "openai-compatible", apiKey: "", model: "", baseUrl: "" };
  return { provider: saved.provider, apiKey: "", model: saved.model, baseUrl: saved.baseUrl ?? "" };
}

function toConfig(form: ByokFormState): ByokConfig {
  const baseUrl = form.baseUrl.trim();
  return {
    provider: form.provider,
    apiKey: form.apiKey,
    model: form.model.trim(),
    ...(form.provider === "openai-compatible" && baseUrl !== "" ? { baseUrl } : {}),
  };
}

const PROBE_ERRORS: Readonly<Record<Exclude<ByokProbeOutcome["kind"], "ok" | "invalid">, ByokInlineError>> = {
  rejected: "credential_rejected",
  unreachable: "unreachable",
  requires_login: "requires_login",
  error: "probe_failed",
};

interface ProbeSink {
  readonly setVision: (vision: boolean | null) => void;
  readonly setError: (error: ByokInlineError | null) => void;
  readonly setPhase: (phase: ByokPhase) => void;
}

/** #479 P2-1: a non-definitive probe (any `error_code` on a 200) leaves the
 * stored vision flag in its unprobed `null` state — `vision: false` is only
 * persisted when the provider itself cleanly refused the image part. */
function applyOk(outcome: Extract<ByokProbeOutcome, { kind: "ok" }>, sink: ProbeSink): void {
  if (!outcome.definitive) {
    sink.setVision(null);
    return;
  }
  setByokVisionSupported(outcome.vision);
  sink.setVision(outcome.vision);
}

function applyOutcome(outcome: ByokProbeOutcome, sink: ProbeSink): void {
  sink.setPhase("idle");
  if (outcome.kind === "ok") {
    applyOk(outcome, sink);
    return;
  }
  sink.setError(outcome.kind === "invalid" ? outcome.code : PROBE_ERRORS[outcome.kind]);
}

type Probe = typeof runByokProbe;
interface Generation { current: number }

/** #480 P2-2: each run claims a generation; clearing (or re-saving) bumps it,
 * so a stale in-flight probe can never paint its outcome over the panel. */
function useProbeRun(baseUrl: string, probe: Probe, sink: ProbeSink, generation: Generation): () => void {
  return useCallback(() => {
    const claimed = ++generation.current;
    const settle = (outcome: ByokProbeOutcome) => {
      if (generation.current === claimed) applyOutcome(outcome, sink);
    };
    sink.setPhase("checking");
    void probe(baseUrl).then(settle).catch(() => { settle({ kind: "error" }); });
  }, [baseUrl, probe, sink, generation]);
}

interface PanelState {
  readonly form: ByokFormState;
  readonly saved: boolean;
  readonly vision: boolean | null;
  readonly phase: ByokPhase;
  readonly error: ByokInlineError | null;
}

function initialState(): PanelState {
  return {
    form: initialForm(),
    saved: getByokConfig() !== null,
    vision: getByokVisionSupported(),
    phase: "idle",
    error: null,
  };
}

type Patch = Partial<PanelState>;
type Apply = (patch: Patch) => void;

function useSink(apply: Apply): ProbeSink {
  return useMemo(() => ({
    setVision: (vision: boolean | null) => { apply({ vision }); },
    setError: (error: ByokInlineError | null) => { apply({ error }); },
    setPhase: (phase: ByokPhase) => { apply({ phase }); },
  }), [apply]);
}

type PatchForm = (patch: Partial<ByokFormState>, form: ByokFormState) => void;

function fieldSetters(form: ByokFormState, patchForm: PatchForm) {
  return {
    setProvider: (provider: ByokProvider) => { patchForm({ provider, model: modelAfterSwitch(provider, form.model) }, form); },
    setApiKey: (apiKey: string) => { patchForm({ apiKey }, form); },
    setModel: (model: string) => { patchForm({ model }, form); },
    setBaseUrl: (baseUrl: string) => { patchForm({ baseUrl }, form); },
  };
}

function useFieldSetters(state: PanelState, apply: Apply) {
  const patchForm = useCallback<PatchForm>((patch, form) => {
    apply({ form: { ...form, ...patch }, error: null });
  }, [apply]);
  return fieldSetters(state.form, patchForm);
}

function commitSave(form: ByokFormState, apply: Apply, runProbe: () => void): void {
  const result = saveByokConfig(toConfig(form));
  if (!result.ok) {
    apply({ error: result.error });
    return;
  }
  apply({ form: { ...form, apiKey: "" }, saved: true, vision: null, error: null });
  runProbe();
}

function useSaveAction(state: PanelState, apply: Apply, runProbe: () => void): () => void {
  const { form } = state;
  return useCallback(() => { commitSave(form, apply, runProbe); }, [form, apply, runProbe]);
}

function useClearAction(apply: Apply, generation: Generation): () => void {
  return useCallback(() => {
    generation.current += 1;
    clearByokConfig();
    apply({ ...initialState() });
  }, [apply, generation]);
}

export function useByokSettings(baseUrl: string, probe: Probe = runByokProbe): ByokSettingsView {
  const [state, setState] = useState<PanelState>(initialState);
  const generation = useRef(0);
  const apply = useCallback<Apply>((patch) => { setState((prev) => ({ ...prev, ...patch })); }, []);
  const runProbe = useProbeRun(baseUrl, probe, useSink(apply), generation);
  const save = useSaveAction(state, apply, runProbe);
  return { ...state, ...useFieldSetters(state, apply), save, clear: useClearAction(apply, generation) };
}
