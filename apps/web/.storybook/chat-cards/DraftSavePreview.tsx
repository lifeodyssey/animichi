import { useState } from "react";
import type { ChatDict } from "../../src/features/chat/i18n";
import type { ItineraryDraftPlan } from "../../src/features/chat/lib/itinerary-draft";
import { ItineraryDraft } from "../../src/features/chat/components/ItineraryDraft";
import type { DraftSaveState } from "../../src/features/chat/components/DraftSaveActions";
import { LoginModal } from "../../src/features/auth/ui/LoginModal";

export interface DraftSavePreviewProps {
  readonly draft: ItineraryDraftPlan;
  readonly dict: ChatDict;
  readonly status: DraftSaveState["status"];
  readonly onSave: (draftId: string) => void;
  readonly onAdjust: (draftId: string) => void;
  readonly onLogin: (draftId: string) => void;
  readonly onView: (savedId: string) => void;
}

function stateFor(props: DraftSavePreviewProps, status: DraftSaveState["status"], openLogin: (draftId: string) => void): DraftSaveState {
  const draftId = props.draft.id;
  if (status === "login-required") return { draftId, status, onLogin: openLogin };
  if (status === "saved") return { draftId, status, savedId: `saved-example-${draftId}`, onView: props.onView };
  return { draftId, status };
}

/** Outcomes are explicit story fixtures. Clicking save can only enter the waiting state. */
export function DraftSavePreview(props: DraftSavePreviewProps) {
  const [status, setStatus] = useState(props.status), [loginOpen, setLoginOpen] = useState(false);
  const onLogin = (draftId: string) => { props.onLogin(draftId); setLoginOpen(true); };
  const onSave = (draftId: string) => { props.onSave(draftId); setStatus("saving"); };
  return <div style={{ width: "min(480px, calc(100vw - 80px))", maxWidth: "100%" }}><ItineraryDraft draft={props.draft} dict={props.dict} saveState={stateFor(props, status, onLogin)} onSave={onSave} onAdjust={props.onAdjust} />
    <LoginModal open={loginOpen} onClose={() => { setLoginOpen(false); }} returnTarget="/chat?session=storybook" />
  </div>;
}
