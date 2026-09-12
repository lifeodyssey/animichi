import type { Decorator } from "@storybook/react";
import { fn } from "storybook/test";
import { ChatActionsProvider } from "../../src/features/chat/ChatActions";
import { ChatReturnTargetProvider } from "../../src/features/chat/ChatReturnTarget";

const actions = { send: fn(), regenerate: fn() };

export const withChatErrors: Decorator = (Story) => (
  <ChatReturnTargetProvider sessionIdOf={() => "storybook-session"}>
    <ChatActionsProvider actions={actions}><Story /></ChatActionsProvider>
  </ChatReturnTargetProvider>
);
