import type { ChatStatus, UIMessage } from "ai";
import { routeDocumentKey, supersededFlags } from "../../../lib/chat/supersession";
import type { ChatDict } from "../i18n";
import { formatElapsed } from "../telemetry";
import { statusedSteps } from "../tool-steps";
import { DataPartCard } from "./DataPartCard";
import { SettledFootprint } from "./SettledFootprint";
import { ToolStepBadge } from "./ToolStepBadge";

type Part = UIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;
type PartProps = Readonly<{ part: Part; dict: ChatDict; superseded: boolean }>;

function isToolPart(part: Part): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function nonToolParts(message: UIMessage): readonly Part[] {
  return message.parts.filter((part) => !isToolPart(part));
}

function MessagePart({ part, dict, superseded }: PartProps) {
  if (part.type === "text") return <p className="chat-bubble">{part.text}</p>;
  if (part.type === "data-response") return <DataPartCard data={part.data} dict={dict} superseded={superseded} />;
  return null;
}

function partKey(messageId: string, part: Part, index: number): string {
  return `${messageId}:${part.type}:${String(index)}`;
}

interface DataPartRef {
  readonly key: string;
  readonly data: unknown;
}

function messageDataParts(message: UIMessage): readonly DataPartRef[] {
  const refs: DataPartRef[] = [];
  for (const [index, part] of nonToolParts(message).entries()) {
    if (part.type === "data-response") refs.push({ key: partKey(message.id, part, index), data: part.data });
  }
  return refs;
}

/**
 * E1 living-document pass (issue #271, generalized for #273): collect every
 * streamed data part in conversation order and flag the ones a newer card of
 * the same document supersedes. Route cards are the first keyed document.
 */
function supersededPartKeys(messages: readonly UIMessage[]): ReadonlySet<string> {
  const refs = messages.flatMap(messageDataParts);
  const flags = supersededFlags(refs.map((ref) => routeDocumentKey(ref.data)));
  return new Set(refs.filter((_, index) => flags[index] === true).map((ref) => ref.key));
}

function ToolBadges({ parts, dict }: Readonly<{ parts: readonly ToolPart[]; dict: ChatDict }>) {
  return statusedSteps(parts).map(({ step, status }) => (
    <ToolStepBadge key={step.toolCallId} type={step.type} status={status} dict={dict} />
  ));
}

type PipelineProps = Readonly<{
  parts: readonly ToolPart[];
  settled: boolean;
  elapsedLabel?: string;
  dict: ChatDict;
}>;

function Pipeline({ parts, settled, elapsedLabel, dict }: PipelineProps) {
  if (parts.length === 0) return null;
  const badges = <ToolBadges parts={parts} dict={dict} />;
  if (!settled) return badges;
  return <SettledFootprint elapsedLabel={elapsedLabel} dict={dict}>{badges}</SettledFootprint>;
}

type BodyProps = Readonly<{
  parts: readonly Part[];
  messageId: string;
  dict: ChatDict;
  supersededKeys: ReadonlySet<string>;
}>;

function MessageBody({ parts, messageId, dict, supersededKeys }: BodyProps) {
  return parts.map((part, index) => {
    const key = partKey(messageId, part, index);
    return <MessagePart key={key} part={part} dict={dict} superseded={supersededKeys.has(key)} />;
  });
}

type ItemProps = Readonly<{
  message: UIMessage;
  dict: ChatDict;
  settled: boolean;
  elapsedLabel?: string;
  supersededKeys: ReadonlySet<string>;
}>;

function MessageItem({ message, dict, settled, elapsedLabel, supersededKeys }: ItemProps) {
  const tools = message.parts.filter(isToolPart);
  return (
    <li className={`chat-message chat-message--${message.role}`}>
      <Pipeline parts={tools} settled={settled} elapsedLabel={elapsedLabel} dict={dict} />
      <MessageBody parts={nonToolParts(message)} messageId={message.id} dict={dict} supersededKeys={supersededKeys} />
    </li>
  );
}

function isActive(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

function elapsedFor(isLast: boolean, settledDurationMs?: number): string | undefined {
  if (!isLast || settledDurationMs === undefined) return undefined;
  return formatElapsed(settledDurationMs);
}

type RowProps = Readonly<{
  message: UIMessage;
  isLast: boolean;
  dict: ChatDict;
  status: ChatStatus;
  settledDurationMs?: number;
  supersededKeys: ReadonlySet<string>;
}>;

function MessageRow({ message, isLast, dict, status, settledDurationMs, supersededKeys }: RowProps) {
  const settled = !(isLast && isActive(status));
  return (
    <MessageItem message={message} dict={dict} settled={settled} elapsedLabel={elapsedFor(isLast, settledDurationMs)} supersededKeys={supersededKeys} />
  );
}

type ListProps = Readonly<{
  messages: readonly UIMessage[];
  dict: ChatDict;
  status: ChatStatus;
  settledDurationMs?: number;
}>;

export function MessageList({ messages, dict, status, settledDurationMs }: ListProps) {
  if (messages.length === 0) return null;
  const lastIndex = messages.length - 1;
  const supersededKeys = supersededPartKeys(messages);
  const items = messages.map((message, index) => (
    <MessageRow key={message.id} message={message} isLast={index === lastIndex} dict={dict} status={status} settledDurationMs={settledDurationMs} supersededKeys={supersededKeys} />
  ));
  return <ol className="chat-messages">{items}</ol>;
}
