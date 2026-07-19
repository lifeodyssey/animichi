import { readFileSync } from "node:fs";
import { ChatResponseDataPart } from "../../../../../packages/contract/src/chat-data-parts.ts";

const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(ChatResponseDataPart.parse(parsed).intent);
