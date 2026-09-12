import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { requestGeoPermission } from "../../../platform/geo";
import type { GeoPermission } from "../../../platform/geo";
import type { ChatDict } from "../i18n";
import { LocationPromptView } from "./LocationPromptView";
import type { LocationPromptState } from "./LocationPromptView";

type Props = Readonly<{
  dict: ChatDict;
  disabled?: boolean;
  onLocated: (lat: number, lng: number) => void;
  onManual: (text: string) => void;
}>;

type SetState = (state: LocationPromptState) => void;
type Request = Readonly<{ attempt: RefObject<{ revision: number }>; setState: SetState; onLocated: Props["onLocated"] }>;

function settle(permission: GeoPermission, request: Request): void {
  if (permission.status === "denied") { request.setState({ phase: "denied" }); return; }
  request.setState({ phase: "sent" });
  request.onLocated(permission.lat, permission.lng);
}

async function locate(request: Request): Promise<void> {
  const revision = ++request.attempt.current.revision;
  request.setState({ phase: "pending" });
  try {
    const permission = await requestGeoPermission();
    if (revision === request.attempt.current.revision) settle(permission, request);
  } catch {
    if (revision === request.attempt.current.revision) request.setState({ phase: "denied" });
  }
}

/** A manual answer or unmount supersedes any outstanding location request. */
function useLocationRequest({ onLocated, onManual, disabled }: Props) {
  const [state, setState] = useState<LocationPromptState>({ phase: "idle" });
  const attempt = useRef({ revision: 0 });
  useEffect(() => { const current = attempt.current; return () => { current.revision += 1; }; }, []);
  const allow = useCallback(() => { if (!disabled && state.phase !== "pending" && state.phase !== "sent") void locate({ attempt, setState, onLocated }); }, [onLocated, disabled, state.phase]);
  const manual = useCallback((text: string) => {
    attempt.current.revision += 1; setState({ phase: "sent", place: text }); onManual(text);
  }, [onManual]);
  return { state, allow, manual };
}

export function LocationPrompt(props: Props) {
  const { state, allow, manual } = useLocationRequest(props);
  return <LocationPromptView dict={props.dict} disabled={props.disabled} state={state} onLocate={allow} onManual={manual} />;
}
