import type { ChatDataPart } from "@animichi/contract";
import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { ChatActionsProvider, useChatActions } from "../ChatActions";
import type { ChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import {
  PHOTO_CHALLENGED,
  confirmPhotoSearch,
  isOversizedPhoto,
  isSupportedPhoto,
  postPhotoSearch,
} from "../photo-search";
import type {
  PhotoGuidance,
  PhotoSearchContext,
  PhotoSearchOutcome,
} from "../photo-search";
import { candidatesOf } from "./Cards";
import { DataPartCard } from "./DataPartCard";

/** Photo-search upload (issue #260 AC4/AC5/AC7, AGENT-1 #952): the result
 * envelope renders through DataPartCard, sharing the text-search render
 * path; selecting a candidate confirms the server-issued photo offer (AC11);
 * failures show on-brand copy with a retry — never a stuck spinner. */

type UploadError = "unsupported" | "tooLarge" | "failed" | "challenge";

type UploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "error"; readonly error: UploadError }
  | { readonly kind: "quota"; readonly guidance: PhotoGuidance }
  | { readonly kind: "done"; readonly part: ChatDataPart; readonly offerId: string };

type Props = Readonly<{ dict: ChatDict; baseUrl: string; context: PhotoSearchContext }>;

function quotaCopy(dict: ChatDict, guidance: PhotoGuidance): string {
  if (guidance === "switch_vision_endpoint") return dict.photo.quotaByokNoVision;
  return dict.photo.quotaNoByok;
}

function errorCopy(dict: ChatDict, error: UploadError): string {
  if (error === "unsupported") return dict.photo.unsupported;
  if (error === "tooLarge") return dict.photo.tooLarge;
  if (error === "challenge") return dict.turnstile.failed;
  return dict.photo.failed;
}

type ErrorProps = Readonly<{ dict: ChatDict; error: UploadError; onRetry: () => void }>;

function UploadFailure({ dict, error, onRetry }: ErrorProps) {
  return (
    <p className="chat-photo__error" role="alert">
      {errorCopy(dict, error)}
      <button type="button" className="chat-photo__retry" onClick={onRetry}>{dict.photo.retry}</button>
    </p>
  );
}

type StatusProps = Readonly<{ dict: ChatDict; state: UploadState; onRetry: () => void }>;

function UploadStatus({ dict, state, onRetry }: StatusProps) {
  if (state.kind === "uploading") {
    return <p className="chat-photo__status" role="status" aria-busy="true">{dict.photo.uploading}</p>;
  }
  if (state.kind === "error") return <UploadFailure dict={dict} error={state.error} onRetry={onRetry} />;
  if (state.kind === "quota") return <p className="chat-photo__error" role="alert">{quotaCopy(dict, state.guidance)}</p>;
  return null;
}

/** The candidate the user picked, resolved back to its offer candidate id. */
function candidateIdOf(part: ChatDataPart, title: string): string | undefined {
  return candidatesOf(part).find((candidate) => candidate.title === title)?.id;
}

function makeConfirmSend(actions: ChatActions, confirm: (title: string) => void) {
  return (text: string) => {
    confirm(text);
    actions.send(text);
  };
}

type ConfirmProps = Readonly<{
  baseUrl: string;
  offerId: string;
  part: ChatDataPart;
  context: PhotoSearchContext;
}>;

/** Selecting a candidate from a photo result confirms the photo offer (AC11). */
function confirmingActions(actions: ChatActions, props: ConfirmProps): ChatActions {
  const confirm = (title: string) => {
    confirmPhotoSearch(props.baseUrl, props.offerId, candidateIdOf(props.part, title), props.context);
  };
  return { ...actions, send: makeConfirmSend(actions, confirm) };
}

type ResultProps = Readonly<{ dict: ChatDict; props: ConfirmProps }>;

function PhotoResult({ dict, props }: ResultProps) {
  const actions = useChatActions();
  const decorated = confirmingActions(actions, props);
  return (
    <ChatActionsProvider actions={decorated}>
      <DataPartCard data={props.part} dict={dict} />
    </ChatActionsProvider>
  );
}

type SetUploadState = (state: UploadState) => void;

function settledState(outcome: PhotoSearchOutcome): UploadState {
  return outcome.kind === "quota" ? outcome : { kind: "done", part: outcome.part, offerId: outcome.offerId };
}

/** A rejected challenge reads as its own state so the visitor is told to
 * redo the check, not that their photo was bad (issue #447 review). */
function uploadErrorOf(cause: unknown): UploadError {
  return cause instanceof Error && cause.message === PHOTO_CHALLENGED ? "challenge" : "failed";
}

function runUpload(baseUrl: string, file: File, context: PhotoSearchContext, setState: SetUploadState): void {
  setState({ kind: "uploading" });
  postPhotoSearch(baseUrl, file, context)
    .then((outcome) => { setState(settledState(outcome)); })
    .catch((cause: unknown) => { setState({ kind: "error", error: uploadErrorOf(cause) }); });
}

function preflightError(file: File): UploadError | null {
  if (!isSupportedPhoto(file)) return "unsupported";
  if (isOversizedPhoto(file)) return "tooLarge";
  return null;
}

function makeUpload(baseUrl: string, context: PhotoSearchContext, setState: SetUploadState) {
  return (file: File) => {
    const error = preflightError(file);
    if (error !== null) {
      setState({ kind: "error", error });
      return;
    }
    runUpload(baseUrl, file, context, setState);
  };
}

function useUpload(baseUrl: string, context: PhotoSearchContext) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const upload = useMemo(() => makeUpload(baseUrl, context, setState), [baseUrl, context]);
  const reset = useCallback(() => { setState({ kind: "idle" }); }, []);
  return { state, upload, reset };
}

function makeFileChange(upload: (file: File) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file);
  };
}

function UploadControl({ dict, onChange }: Readonly<{ dict: ChatDict; onChange: (event: ChangeEvent<HTMLInputElement>) => void }>) {
  return (
    <>
      <label className="chat-photo__label">{dict.photo.upload}<input type="file" className="chat-photo__input" accept="image/jpeg,image/png,image/webp" aria-label={dict.photo.upload} onChange={onChange} /></label>
      <span className="chat-photo__note">{dict.photo.processedNote}</span>
    </>
  );
}

function ResultGate({ dict, baseUrl, state, context }: Readonly<{ dict: ChatDict; baseUrl: string; state: UploadState; context: PhotoSearchContext }>) {
  if (state.kind !== "done") return null;
  return <PhotoResult dict={dict} props={{ baseUrl, offerId: state.offerId, part: state.part, context }} />;
}

type OutcomeProps = Readonly<{ dict: ChatDict; baseUrl: string; state: UploadState; context: PhotoSearchContext; onRetry: () => void }>;

function UploadOutcome({ dict, baseUrl, state, context, onRetry }: OutcomeProps) {
  return (
    <>
      <UploadStatus dict={dict} state={state} onRetry={onRetry} />
      <ResultGate dict={dict} baseUrl={baseUrl} state={state} context={context} />
    </>
  );
}

export function PhotoSearchUpload({ dict, baseUrl, context }: Props) {
  const { state, upload, reset } = useUpload(baseUrl, context);
  return (
    <div className="chat-photo">
      <UploadControl dict={dict} onChange={makeFileChange(upload)} />
      <UploadOutcome dict={dict} baseUrl={baseUrl} state={state} context={context} onRetry={reset} />
    </div>
  );
}
