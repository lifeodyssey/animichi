import type { ChatStatus, UIMessage } from "ai";
import type { ChatDict } from "../i18n";
import { formatElapsed } from "../telemetry";
import { DataPartCard } from "./DataPartCard";
import { SettledFootprint } from "./SettledFootprint";
import { ToolStepBadge } from "./ToolStepBadge";

type Part = UIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;
type PartProps = Readonly<{ part: Part; dict: ChatDict }>;

function isToolPart(part: Part): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function MessagePart({ part, dict }: PartProps) {
  if (part.type === "text") return <p className="chat-bubble">{part.text}</p>;
  if (part.type === "data-response") return <DataPartCard data={part.data} dict={dict} />;
  return null;
}

function partKey(messageId: string, part: Part, index: number): string {
  return `${messageId}:${part.type}:${String(index)}`;
}

function ToolBadges({ parts }: Readonly<{ parts: readonly ToolPart[] }>) {
  return parts.map((part) => <ToolStepBadge key={part.toolCallId} type={part.type} state={part.state} />);
}

type PipelineProps = Readonly<{
  parts: readonly ToolPart[];
  settled: boolean;
  elapsedLabel?: string;
  dict: ChatDict;
}>;

function Pipeline({ parts, settled, elapsedLabel, dict }: PipelineProps) {
  if (parts.length === 0) return null;
  const badges = <ToolBadges parts={parts} />;
  if (!settled) return badges;
  return <SettledFootprint elapsedLabel={elapsedLabel} dict={dict}>{badges}</SettledFootprint>;
}

function MessageBody({ parts, messageId, dict }: Readonly<{ parts: readonly Part[]; messageId: string; dict: ChatDict }>) {
  return parts.map((part, index) => (
    <MessagePart key={partKey(messageId, part, index)} part={part} dict={dict} />
  ));
}

type ItemProps = Readonly<{
  message: UIMessage;
  dict: ChatDict;
  settled: boolean;
  elapsedLabel?: string;
}>;

function MessageItem({ message, dict, settled, elapsedLabel }: ItemProps) {
  const tools = message.parts.filter(isToolPart);
  const rest = message.parts.filter((part) => !isToolPart(part));
  return (
    <li className={`chat-message chat-message--${message.role}`}>
      <Pipeline parts={tools} settled={settled} elapsedLabel={elapsedLabel} dict={dict} />
      <MessageBody parts={rest} messageId={message.id} dict={dict} />
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
}>;

function MessageRow({ message, isLast, dict, status, settledDurationMs }: RowProps) {
  const settled = !(isLast && isActive(status));
  return (
    <MessageItem message={message} dict={dict} settled={settled} elapsedLabel={elapsedFor(isLast, settledDurationMs)} />
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
  const items = messages.map((message, index) => (
    <MessageRow key={message.id} message={message} isLast={index === lastIndex} dict={dict} status={status} settledDurationMs={settledDurationMs} />
  ));
  return <ol className="chat-messages">{items}</ol>;
}
