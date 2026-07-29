import { vi } from "vitest";
import type { ChatActions } from "../../../src/features/chat/chat-actions";

/**
 * One mock shape for the whole `ChatActions` surface. The D12 lock tests are
 * assertions that *nothing* fired, so a mock missing an action would pass
 * vacuously — building it in one place keeps every lock test checking the same
 * complete surface as the interface grows.
 */
export function mockChatActions(): ChatActions {
  return { send: vi.fn(), regenerate: vi.fn(), sendWithOrigin: vi.fn() };
}
