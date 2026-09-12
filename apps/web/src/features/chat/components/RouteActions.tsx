import { LoginModal } from "../../auth/ui/LoginModal";
import { AnimalButton, animalButtonClass } from "./AnimalButton";
import { useChatReturnTarget } from "../ChatReturnTarget";
import type { ItineraryView } from "../lib/itinerary";
import type { ChatDict } from "../i18n";
import { useSaveGate } from "../save/use-save-gate";
import type { SaveGate, SaveGateOptions } from "../save/use-save-gate";
import type { SaveTarget } from "../save/save-target";
import { FallbackRetryButton } from "./ErrorStates/FallbackRetryButton";

type DictProps = Readonly<{ dict: ChatDict }>;
type ViewProps = Readonly<{ view: ItineraryView; dict: ChatDict }>;
type GateProps = Readonly<{ gate: SaveGate; dict: ChatDict }>;
export type RouteActionProps = ViewProps & Readonly<{ save?: SaveTarget; saveDeps?: SaveGateOptions }>;

function MapsCta({ view, dict }: ViewProps) {
  if (view.mapsUrl === undefined) return null;
  return (
    <a className={animalButtonClass({ tone: "explore" })} data-tone="explore" href={view.mapsUrl} target="_blank" rel="noreferrer">
      <span className="min-w-0">{dict.route.openMaps}</span>
    </a>
  );
}

/** A retryable failure stays on the card: inline copy plus a retry, never a
 * full page. A `permanent` 4xx gets copy without a retry — offering one would
 * be a loop that cannot succeed. */
function SaveError({ gate, dict }: GateProps) {
  return (
    <span className="chat-cta-row__error" role="alert">
      {dict.route.saveError}
      <FallbackRetryButton label={dict.route.saveRetry} onClick={gate.activate} />
    </span>
  );
}

function SavePermanentError({ dict }: DictProps) {
  return <span className="chat-cta-row__error" role="alert">{dict.route.savePermanentError}</span>;
}

function SaveFeedback({ gate, dict }: GateProps) {
  if (gate.status === "saved") return <span className="chat-cta-row__saved" role="status">{dict.route.saved}</span>;
  if (gate.status === "permanent") return <SavePermanentError dict={dict} />;
  if (gate.status !== "retryable") return null;
  return <SaveError gate={gate} dict={dict} />;
}

/** Saving and saved are both non-actionable: the endpoint has no dedupe key, so
 * a second tap would create a second row. `aria-busy` carries the in-flight
 * meaning that `disabled` alone would flatten into "unavailable". */
function saveDisabled(gate: SaveGate): boolean {
  return gate.action === "none" || gate.status === "saving" || gate.status === "saved";
}

/** Saving stays secondary to opening the route, with the same login gate. */
function SaveButton({ gate, dict }: GateProps) {
  const busy = gate.status === "saving";
  return (
    <AnimalButton appearance="text" className="[min-height:44px]! [padding-inline:6px]!" data-cta="save" disabled={saveDisabled(gate)} aria-busy={busy} onClick={gate.activate}>
      {dict.route.saveCta}
    </AnimalButton>
  );
}

function SaveCta({ save, dict, saveDeps }: Omit<RouteActionProps, "view">) {
  const gate = useSaveGate(save, saveDeps);
  return (
    <>
      <SaveButton gate={gate} dict={dict} />
      <SaveFeedback gate={gate} dict={dict} />
      <SaveLoginWall gate={gate} />
    </>
  );
}

/** The P5 save wall carries the session back (#507 review P1-1): without a
 * return target a correct adoption still lands the visitor on `/`.
 *
 * The hook is read **before** the early return, not inside the JSX after it
 * (#514 review round 2). It is inert today — `useChatReturnTarget` wraps only
 * `useContext`, and `readContext` never joins the hook list, so no ordering can
 * shift. But it is a Rules-of-Hooks violation, and this repo cannot catch it:
 * the root `.oxlintrc.json` runs `plugins: ["typescript"]` with
 * `categories.correctness: "off"`, and `apps/web` adds only
 * `max-lines-per-function` — not one react-hooks rule is enabled anywhere, so
 * a green lint carries no information here. The day `useChatReturnTarget` grows
 * a `useMemo`, or React Compiler lands, this becomes a runtime crash in the
 * headline #507 component. */
function SaveLoginWall({ gate }: Readonly<{ gate: ReturnType<typeof useSaveGate> }>) {
  const returnTarget = useChatReturnTarget();
  if (!gate.loginOpen) return null;
  return <LoginModal open onClose={gate.closeLogin} onSendCommitted={gate.markSendCommitted} returnTarget={returnTarget} />;
}

export function RouteActions({ view, dict, save, saveDeps }: RouteActionProps) {
  return (
    <div className="chat-cta-row">
      <MapsCta view={view} dict={dict} />
      <SaveCta save={save} dict={dict} saveDeps={saveDeps} />
    </div>
  );
}
