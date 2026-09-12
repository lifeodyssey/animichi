import { useId } from "react";
import type { MouseEvent } from "react";
import { Button } from "animal-island-ui-tailwind/button";
import { chatSessionTarget } from "../ChatReturnTarget";
import type { ChatDict } from "../i18n";
import { recentConversationsCopy } from "../recent-conversations-copy";
import type { ConversationListStatus, ConversationSummary } from "../use-conversation-list";

export interface RecentConversationsProps {
  readonly dict: ChatDict;
  readonly conversations: readonly ConversationSummary[];
  readonly status: ConversationListStatus;
  readonly activeSessionId?: string;
  readonly onRetry: () => void;
  /** Optional same-tab navigation; modified clicks retain the native link destination. */
  readonly onOpen?: (sessionId: string) => void;
}

type RowProps = Pick<RecentConversationsProps, "dict" | "onOpen"> & Readonly<{ conversation: ConversationSummary; active: boolean }>;
const ROW = "animal-btn animal-btn-text [display:flex]! [height:auto]! [min-height:64px]! [width:100%]! [justify-content:flex-start]! [border-radius:16px]! [padding:12px_14px]! [white-space:normal]! [text-align:left]! [text-decoration:none]! focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const ROW_TOKENS = "[--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)]";
const ACTIVE = "[background-color:var(--color-primary-soft)]! [--animal-text-color:var(--color-primary-ink)]";
const RETRY = "[min-height:44px]! [height:auto]! [padding:10px_14px]! [font-size:14px]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function openConversation(event: MouseEvent<HTMLAnchorElement>, props: RowProps) {
  if (!props.onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  props.onOpen(props.conversation.id);
}

function ConversationRow(props: RowProps) {
  const copy = recentConversationsCopy(props.dict.locale), subtitleId = useId();
  const subtitle = props.conversation.subtitle.trim(), title = props.conversation.title.trim() || subtitle || copy.untitled;
  const showSubtitle = subtitle !== "" && subtitle !== title;
  return <li className="min-w-0"><a href={chatSessionTarget(props.conversation.id)} className={`${ROW} ${ROW_TOKENS} ${props.active ? ACTIVE : ""}`} aria-label={title} aria-describedby={showSubtitle ? subtitleId : undefined} aria-current={props.active ? "page" : undefined} title={title} onClick={(event) => { openConversation(event, props); }}>
    <span className="grid min-w-0 flex-1 gap-1"><span className="line-clamp-2 text-[15px] font-bold leading-6 tracking-[-0.01em] [overflow-wrap:anywhere]">{title}</span>{showSubtitle ? <span id={subtitleId} className="truncate text-xs font-medium leading-5 text-muted-fg">{subtitle}</span> : null}</span>
  </a></li>;
}

function LoadingConversations({ dict }: Pick<RecentConversationsProps, "dict">) {
  return <div className="grid gap-1 px-1" role="status"><span className="sr-only">{recentConversationsCopy(dict.locale).loading}</span>
    {["w-3/4", "w-2/3", "w-4/5"].map((width) => <div key={width} aria-hidden="true" className="grid min-h-[76px] content-center gap-2.5 rounded-2xl px-3.5 motion-safe:animate-pulse motion-reduce:animate-none"><span className={`h-3.5 rounded-full bg-border-soft ${width}`} /><span className="h-2.5 w-1/2 rounded-full bg-border-soft/60" /></div>)}
  </div>;
}

function EmptyConversations({ dict }: Pick<RecentConversationsProps, "dict">) {
  const copy = recentConversationsCopy(dict.locale);
  return <div className="grid gap-1.5 px-3.5 py-5"><p className="text-sm font-bold leading-6">{copy.empty}</p><p className="text-sm leading-6 text-muted-fg">{copy.emptyHint}</p></div>;
}

function ConversationFailure({ dict, onRetry, conversations }: RecentConversationsProps) {
  const copy = recentConversationsCopy(dict.locale), hasRows = conversations.length > 0;
  return <div className="grid justify-items-start gap-1 px-3.5 py-2"><div role="alert" className="grid gap-1 text-sm leading-6"><p className={hasRows ? "text-muted-fg" : "font-bold"}>{hasRows ? copy.stale : copy.failed}</p>{hasRows ? null : <p className="text-muted-fg">{copy.failedHint}</p>}</div><Button type="text" htmlType="button" className={RETRY} onClick={() => { onRetry(); }}>{copy.retry}</Button></div>;
}

function ConversationRows(props: RecentConversationsProps) {
  return <ol data-conversation-scroll className="relative grid min-h-0 gap-1 overflow-y-auto overscroll-contain p-1 [max-height:min(480px,60dvh)] [scrollbar-gutter:stable]">
    {props.conversations.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === props.activeSessionId} dict={props.dict} onOpen={props.onOpen} />)}
  </ol>;
}

function ConversationContent(props: RecentConversationsProps) {
  if (props.conversations.length > 0) return <ConversationRows {...props} />;
  if (props.status === "loading") return <LoadingConversations dict={props.dict} />;
  if (props.status === "success") return <EmptyConversations dict={props.dict} />;
  return null;
}

/** Presentational list: the caller owns identity, loading, retry and the active conversation. */
export function RecentConversations(props: RecentConversationsProps) {
  const headingId = useId(), copy = recentConversationsCopy(props.dict.locale);
  if (props.status === "idle") return null;
  return <nav aria-labelledby={headingId} className="relative grid min-w-0 gap-2 text-fg">
    <h2 id={headingId} className="px-[18px] pb-1 text-xs font-bold leading-5 tracking-wide text-muted-fg">{copy.heading}</h2>
    {props.status === "loading" && props.conversations.length > 0 ? <p role="status" className="px-[18px] text-xs leading-5 text-muted-fg">{copy.refreshing}</p> : null}
    <ConversationContent {...props} />{props.status === "error" ? <ConversationFailure {...props} /> : null}
  </nav>;
}
