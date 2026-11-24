import type { ListWrite } from "@earendil-works/pi-agent-core/harness/session";
import type { KeyLiterals } from "../egress/key-literals.ts";
import { redactBlock, redactMessage } from "./stored-record-redaction.ts";

const FRAMES = "pi.pending.assistant_frame";
type Frame = Record<string, unknown>;

function isFrame(value: unknown): value is Frame {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Per streamed block, the end of its text that could still begin a key. */
class HeldTails {
  readonly #tails = new Map<string, string>();

  /** What a chunk stores: the block's held tail and the chunk, redacted, less whatever could still begin a key. */
  pass(block: string, chunk: unknown, literals: KeyLiterals): unknown {
    if (typeof chunk !== "string") return chunk;
    const combined = literals.text((this.#tails.get(block) ?? "") + chunk);
    const kept = combined.length - literals.heldTail(combined);
    this.#tails.set(block, combined.slice(kept));
    return combined.slice(0, kept);
  }

  end(block: string) {
    this.#tails.delete(block);
  }

  endStream(stream: string) {
    for (const block of this.#tails.keys()) if (block.startsWith(`${stream}#`)) this.#tails.delete(block);
  }
}

type FrameRule = (frame: Frame, block: string, held: HeldTails, literals: KeyLiterals) => Frame;

/** Partial tool-call arguments, less the end of their last string that could still begin a key. */
function withoutHeldTail(value: unknown, literals: KeyLiterals): unknown {
  if (typeof value === "string") return value.slice(0, value.length - literals.heldTail(value));
  if (Array.isArray(value)) return value.map((item: unknown, index) => index === value.length - 1 ? withoutHeldTail(item, literals) : item);
  if (!isFrame(value)) return value;
  const fields = Object.entries(value);
  return Object.fromEntries(fields.map(([key, field], index) => [key, index === fields.length - 1 ? withoutHeldTail(field, literals) : field]));
}

/** A tool call's start frame, with its partial arguments redacted. */
const startToolCall: FrameRule = (frame, block, held, literals) => {
  held.end(block);
  const toolCall = redactBlock(frame.toolCall, literals);
  return { ...frame, toolCall: isFrame(toolCall) ? { ...toolCall, arguments: withoutHeldTail(toolCall.arguments, literals) } : toolCall };
};

const passDelta: FrameRule = (frame, block, held, literals) => ({ ...frame, delta: held.pass(block, frame.delta, literals) });
/** A block's end frame, with its whole text redacted. */
const endText: FrameRule = (frame, block, held, literals) => {
  held.end(block);
  return { ...frame, content: literals.value(frame.content) };
};
function startText(field: "text" | "thinking"): FrameRule {
  return (frame, block, held, literals) => {
    held.end(block);
    return { ...frame, content: isFrame(frame.content) ? { ...frame.content, [field]: held.pass(block, frame.content[field], literals) } : frame.content };
  };
}

/** Each frame kind, as pi-ai's `AssistantMessageFrameEncoder` writes it; a checkpoint restates its block's JSON so far. */
const FRAME_RULES = new Map<string, FrameRule>([
  ["start", (frame, _block, _held, literals) => ({ ...frame, partial: redactMessage(frame.partial, literals) })],
  ["text_start", startText("text")],
  ["thinking_start", startText("thinking")],
  ["text_delta", passDelta],
  ["thinking_delta", passDelta],
  ["toolcall_delta", passDelta],
  ["text_end", endText],
  ["thinking_end", endText],
  ["toolcall_start", startToolCall],
  ["toolcall_checkpoint", (frame, block, held, literals) => { held.end(block); return { ...frame, json: held.pass(block, frame.json, literals) }; }],
  ["toolcall_end", (frame, block, held, literals) => { held.end(block); return { ...frame, arguments: literals.value(frame.arguments) }; }],
]);

/**
 * Redacts the bound keys from an answer's streamed frames, stored one commit per chunk, so that no stored frame holds
 * a key or any part of one.
 */
export class FrameRedaction {
  readonly #held = new HeldTails();

  list(write: ListWrite, literals: KeyLiterals): ListWrite {
    if (write.namespace !== FRAMES) return write;
    if (write.op === "delete") {
      this.#held.endStream(write.key);
      return write;
    }
    return { ...write, value: this.#frame(write.key, write.value, literals) };
  }

  #frame(stream: string, frame: unknown, literals: KeyLiterals): unknown {
    if (!isFrame(frame) || typeof frame.type !== "string") return frame;
    const block = `${stream}#${typeof frame.contentIndex === "number" ? frame.contentIndex.toString() : ""}`;
    return FRAME_RULES.get(frame.type)?.(frame, block, this.#held, literals) ?? frame;
  }
}
