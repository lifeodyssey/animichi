import { Container } from "@cloudflare/containers";
import nextHandler from "./.open-next/worker.js";
import { createWorkerApp, catalogOutbound, type Env } from "./app.ts";
import { buildContainerEnvVars, DENIED_EGRESS_CIDRS } from "./containerEnv.ts";

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
export { EdgeGuard } from "./edgeGuard.ts";

// Container-level egress network policy (#284 Task 7). `deniedHosts` accepts IP
// CIDR ranges and is enforced by the platform's Container runtime *before* any
// outbound handler runs, and unconditionally — even though `enableInternet` stays
// `true` (required: asyncpg's direct Postgres hop and the catalog.internal binding
// are non-HTTP/private-hostname traffic that must keep working). This is
// declarative platform config, not NET_ADMIN/iptables (confirmed unavailable on
// Cloudflare Containers — see docs/ops/cloudflare-hardening.md §6): it blocks
// plain-HTTP requests to these ranges (the exact shape of the T3/T12 threat —
// cloud-metadata IMDS endpoints are HTTP-only) without requiring `interceptHttps`
// (which would additionally require the container to trust the platform's
// ephemeral MITM CA — a real cost, deferred; see the doc for the reasoning).
export class RuntimeContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  enableInternet = true;
  deniedHosts = DENIED_EGRESS_CIDRS;
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.envVars = buildContainerEnvVars(env);
  }
}

// Container -> catalog over a private hostname, intercepted here and routed to
// the CATALOG service binding (no public internet). Host matches CATALOG_API_URL.
//
// Deny-by-default: with enableInternet = true and no catch-all in outboundByHost,
// every container outbound EXCEPT catalog.internal goes to the public internet by
// design (the agent calls Anitabi, Bangumi, and LLM APIs directly). Catalog's
// privacy rests entirely on this exact host match — any FUTURE internal-only
// service MUST be added to outboundByHost explicitly; it will NOT be private
// otherwise.
RuntimeContainer.outboundByHost = {
  "catalog.internal": (request: Request, env: Env) => catalogOutbound(request, env),
};

export default createWorkerApp({ nextHandler });
