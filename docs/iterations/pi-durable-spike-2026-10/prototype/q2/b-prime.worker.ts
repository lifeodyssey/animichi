/**
 * Route (b′) in workerd: `q2/b-prime/host.ts` in three variants. `/safe|unsafe|streamed/<session id>/<action>` reaches
 * the session's object through the SDK's `getAgentByName`, as the edge does, and calls it over RPC. The DSN binding is
 * the spike's own database on the loopback test server; the connection is a socket, which the runner's sandbox
 * confines to loopback (part A, `evidence/q2-sockets.json`).
 */
import { getAgentByName } from "agents";
import { primeClass, type PrimeEnv } from "./b-prime/host.ts";

export const PrimeSafe = primeClass({ replay: "safe" });
export const PrimeUnsafe = primeClass({ replay: "unsafe" });
/** Faux at 50 tokens/s with long answers: turns that overlap in b′1, and the progress-persistence increment in b′3. */
export const PrimeStreamed = primeClass({ replay: "safe", tokensPerSecond: 50, longAnswers: true });
/** With the covering layers: admission before Pi, the recovery scan and settlement on every wake (C1–C4). */
export const PrimeAdmitted = primeClass({ replay: "safe", business: true });
/** The same layers on the ported provider double: question 3's `settlement` and `selection`. */
export const PrimeDouble = primeClass({ replay: "safe", business: true, provider: "double" });

type Host = InstanceType<typeof PrimeSafe>;
interface Env extends PrimeEnv {
  readonly SAFE: DurableObjectNamespace<Host>;
  readonly UNSAFE: DurableObjectNamespace<Host>;
  readonly STREAMED: DurableObjectNamespace<Host>;
  readonly ADMITTED?: DurableObjectNamespace<Host>;
  readonly DOUBLE?: DurableObjectNamespace<Host>;
}

function namespaceOf(env: Env, binding: string | undefined): DurableObjectNamespace<Host> {
  if (binding === "unsafe") return env.UNSAFE;
  if (binding === "streamed") return env.STREAMED;
  if (binding === "admitted" && env.ADMITTED) return env.ADMITTED;
  if (binding === "double" && env.DOUBLE) return env.DOUBLE;
  return env.SAFE;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [binding, name, action] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    const host = await getAgentByName(namespaceOf(env, binding), name ?? "");
    const body = await request.json() as { operationId?: string; text?: string; crashAt?: string; modelId?: "double-reporting" | "double-silent"; choice?: string };
    if (action === "admit") return Response.json(await host.admit(body.operationId ?? "", body.text ?? "", body.crashAt));
    if (action === "use-model") return Response.json(await host.useModel(body.modelId ?? "double-reporting"));
    if (action === "select") return Response.json(await host.select(body.operationId ?? "", body.choice ?? ""));
    if (action === "submit") return Response.json(await host.submit(body.operationId ?? "", body.text ?? ""));
    if (action === "arm-wake") return Response.json(await host.armWake());
    return Response.json(await host.report(body.operationId ?? ""));
  },
};
