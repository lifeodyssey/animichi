import { readFileSync } from "node:fs";
import { ChatResponseDataPart } from "../../../../../packages/contract/src/chat-data-parts.ts";

if (process.argv.includes("--warm")) {
  process.stdout.write("ready");
  process.exit(0);
}

const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(ChatResponseDataPart.parse(parsed).intent);
