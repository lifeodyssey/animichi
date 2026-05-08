let msgCounter = 0;

/** Generate a unique message ID for chat messages. */
export function createMessageId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}
