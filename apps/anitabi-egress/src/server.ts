/**
 * The entry point the container runs: `node dist/server.mjs`. Everything it
 * does is in start-egress-server.ts; this file only supplies the real
 * environment and the real fetch.
 */
import { startEgressServer } from "./start-egress-server.ts";

void startEgressServer({ env: process.env });
