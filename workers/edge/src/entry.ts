// Composition root and the Worker's `main` (`workers/edge/wrangler.toml`); all
// logic lives in agent/ identity/ gateway/ protect/ proxy/.
//
// #1605 removed the container from this Worker: the `RuntimeContainer` class,
// the `ContainerProxy` re-export and the `catalog.internal` outbound
// interception are gone, and `wrangler.toml` retires the Durable Object class
// with a `deleted_classes` migration tag in every ring. What is left here is
// the module graph the deployed entry actually needs.
import { createWorkerApp } from "./app.ts";

export { EdgeGuard } from "./protect/edge-guard.ts";
export { SessionAgent as AgentSession } from "./agent/host/session-agent.ts";

export default createWorkerApp({});
