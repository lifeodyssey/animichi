import type { ChatClarifyDict } from "../clarify-i18n";
import { useChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import { useClarifyPick } from "../selection/use-clarify-pick";
import { AnimalButton } from "./AnimalButton";
import { ClarifyTextEntry } from "./ClarifyTextEntry";

type Props = Readonly<{ reason?: string; dict: ChatDict; editing: boolean; onCancel?: () => void }>;

export function clarificationPrompt(reason: string | undefined, dict: ChatClarifyDict): string {
  if (reason === "photo_unrecognized") return dict.question;
  if (reason === "missing_location") return dict.locationPrompt;
  if (reason === "anime_not_found") return dict.animeNotFoundPrompt;
  if (reason === "unknown_place") return dict.unknownPlacePrompt;
  if (reason === "place_too_broad") return dict.placeTooBroadPrompt;
  return dict.detailPrompt;
}

function isPlace(reason: string | undefined): boolean {
  return reason === "unknown_place" || reason === "place_too_broad" || reason === "place_ambiguity";
}

function entryCopy(reason: string | undefined, dict: ChatClarifyDict) {
  if (reason === "photo_unrecognized" || reason === "anime_not_found" || reason === "anime_ambiguity") {
    return { label: dict.titleLabel, placeholder: dict.titlePlaceholder, hint: dict.titleHint };
  }
  if (isPlace(reason)) return { label: dict.placeLabel, placeholder: dict.placePlaceholder, hint: dict.placeHint };
  return { label: dict.rephraseAction, placeholder: dict.detailPlaceholder, hint: dict.rephraseHint };
}

function CancelEntry({ dict, onCancel }: Pick<Props, "dict" | "onCancel">) {
  if (!onCancel) return null;
  return <AnimalButton appearance="text" className="[padding:8px_0]! [font-weight:600] [--animal-text-color:var(--color-muted-fg)]" onClick={onCancel}>{dict.clarify.backToChoices}</AnimalButton>;
}

function useDetails(reason: string | undefined, dict: ChatDict) {
  const { send } = useChatActions();
  const { sendable } = useClarifyPick();
  return { send, sendable, copy: entryCopy(reason, dict.clarify) };
}

export function ClarifyDetails({ reason, dict, editing, onCancel }: Props) {
  const { send, sendable, copy } = useDetails(reason, dict);
  return (
    <div className="grid w-full gap-4">
      <p className="text-sm leading-relaxed text-muted-fg">{copy.hint}</p>
      <ClarifyTextEntry label={copy.label} placeholder={copy.placeholder} submitLabel={dict.clarify.submitDetail} sentLabel={dict.clarify.sentDetail} disabled={!sendable} focusOnMount={editing} onSubmit={send} secondaryAction={<CancelEntry dict={dict} onCancel={onCancel} />} />
    </div>
  );
}
