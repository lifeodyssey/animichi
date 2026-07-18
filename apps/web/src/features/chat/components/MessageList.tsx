import type { UIMessage } from "ai";
import type { ChatDict } from "../i18n";
import { DataPartCard } from "./DataPartCard";
import { ToolStepBadge } from "./ToolStepBadge";

type Part = UIMessage["parts"][number];
type PartProps = Readonly<{ part: Part; dict: ChatDict }>;

function isToolPart(part: Part): part is Extract<Part, { toolCallId: string }> {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function MessagePart({ part, dict }: PartProps) {
  if (part.type === "text") return <p className="chat-bubble">{part.text}</p>;
  if (part.type === "data-response") return <DataPartCard data={part.data} dict={dict} />;
  if (isToolPart(part)) return <ToolStepBadge type={part.type} state={part.state} />;
  return null;
}

function partKey(messageId: string, part: Part, index: number): string {
  if (isToolPart(part)) return part.toolCallId;
  return `${messageId}:${part.type}:${String(index)}`;
}

function MessageItem({ message, dict }: Readonly<{ message: UIMessage; dict: ChatDict }>) {
  const parts = message.parts.map((part, index) => (
    <MessagePart key={partKey(message.id, part, index)} part={part} dict={dict} />
  ));
  return <li className={`chat-message chat-message--${message.role}`}>{parts}</li>;
}

export function MessageList({ messages, dict }: Readonly<{ messages: readonly UIMessage[]; dict: ChatDict }>) {
  if (messages.length === 0) return null;
  const items = messages.map((message) => <MessageItem key={message.id} message={message} dict={dict} />);
  return <ol className="chat-messages">{items}</ol>;
}
