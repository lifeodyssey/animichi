/**
 * Route (b) or (b′): does `PiHarness`'s operation API follow a Storage its factory chooses? Three Durable Object classes
 * differ only in the Storage the factory opens Pi on: the one `PiHarness` passes in (the control), a thin wrapper that
 * delegates every call to it, and pi-durable's `MemoryStorage`, the shape of a backend outside this object. One request
 * runs the same scenario on each, within one object lifetime, and reads every answer twice: through `PiHarness`'s
 * operation calls, and from the Storage Pi was actually opened on.
 */
import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, LiveDoc, MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";

type Variant = "given" | "wrapped" | "memory";
interface Env { readonly GIVEN: DurableObjectNamespace; readonly WRAPPED: DurableObjectNamespace; readonly MEMORY: DurableObjectNamespace }

const BG = BACKGROUND_CONTEXT;
const ROOT = 1;

function textOf(message: Message | undefined): string {
  if (message?.role !== "user" && message?.role !== "assistant") return "";
  const content = message.content;
  return typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Short answers, except for "slow", whose long answer streams for about four seconds so an abort lands mid-answer. */
function answer(): FauxResponseFactory {
  return (context) => {
    const text = textOf([...context.messages].reverse().find((message) => message.role === "user"));
    return fauxAssistantMessage(text === "slow" ? `Slow answer: ${"word ".repeat(600)}` : `Answer to: ${text}`);
  };
}

/** The thin wrapper: every call goes to the storage `PiHarness` passed in, counted by method name. */
function delegating(storage: Storage, calls: Record<string, number>): Storage {
  return new Proxy(storage, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls[String(property)] = (calls[String(property)] ?? 0) + 1;
        return (value as (...given: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

async function until(probe: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function routeClass(variant: Variant) {
  return class RouteProbe extends DurableObject<Env> {
    readonly #faux = fauxProvider({ tokensPerSecond: 200 });
    readonly #calls: Record<string, number> = {};
    #opened: Storage | undefined;
    readonly registry = createRegistry();
    readonly harness = new PiHarness({
      harness: ({ storage, context, onWake }) => {
        const models = createModels();
        models.setProvider(this.#faux.provider);
        const chosen = variant === "given" ? storage : variant === "wrapped" ? delegating(storage, this.#calls) : new MemoryStorage();
        this.#opened = chosen;
        return Harness.open(chosen, { models, registry: this.registry, onWake }, context);
      },
      defaults: { model: this.#faux.getModel() },
    });
    readonly lifecycle = Lifecycle.install(this).use(this.harness);

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      this.#faux.setResponses(Array.from({ length: 16 }, () => answer()));
    }

    async onRequest(): Promise<Response> {
      return Response.json(await this.#scenario());
    }

    async #scenario() {
      const pi = await this.harness.pi();
      const opened = this.#opened;
      if (!opened) throw new Error("the factory did not run");
      const harnessStore = await this.harness.storage();
      const bounded = () => withAbortSignal(AbortSignal.timeout(15_000), BG);
      const records = async (operationId: string) => ({
        inPisStorage: (await opened.submissionByRequest(ROOT, operationId, BG))?.status ?? null,
        inPiHarnessStore: (await harnessStore.submissionByRequest(ROOT, operationId, BG))?.status ?? null,
      });
      /** The operation as Pi settles it, reached from the Storage Pi was opened on. */
      const settledByPi = async (operationId: string) => {
        const record = await opened.submissionByRequest(ROOT, operationId, BG);
        const submission = record ? await pi.submission(record.id, BG) : undefined;
        if (!submission) return null;
        const settled = await submission.wait(bounded());
        return { status: settled.status, reason: settled.status === "unanswered" ? settled.reason : undefined };
      };

      const firstReceipt = await this.harness.submit("first", { operationId: "op-1" });
      const firstWait = await this.harness.wait("op-1", { signal: AbortSignal.timeout(15_000) });
      const firstSettledByPi = await settledByPi("op-1");
      const duplicateReceipt = await this.harness.submit("second, with different content", { operationId: "op-1" });
      const duplicateWait = await this.harness.wait("op-1", { signal: AbortSignal.timeout(15_000) });
      const userTexts = (await this.harness.messages()).filter((entry) => entry.kind === "pi.user").map((entry) => textOf(entry.model?.[0]));
      const recordsOfFirst = await records("op-1");

      const slowReceipt = await this.harness.submit("slow", { operationId: "op-2" });
      await until(async () => (await pi.snapshot(LiveDoc, ROOT, BG))?.generation?.message !== undefined, 10_000, "the slow answer to stream");
      const pendingWhileStreaming = await this.harness.pending();
      const sessionsWhileStreaming = await this.harness.sessions.list();
      const abortOfUnknownOperation = await this.harness.abort({ operationId: "never-submitted" });
      const abortOfStreamingOperation = await this.harness.abort({ operationId: "op-2" });
      const slowSettledByPi = await settledByPi("op-2");
      const slowWait = await this.harness.wait("op-2", { signal: AbortSignal.timeout(15_000) });
      const recordsOfSlow = await records("op-2");

      return {
        variant,
        openedOn: variant === "given" ? "the storage PiHarness passed in" : variant === "wrapped" ? "a Proxy delegating to the storage PiHarness passed in" : "new MemoryStorage()",
        sameObjectPiHarnessReads: opened === harnessStore,
        first: { receipt: firstReceipt, wait: firstWait, settledByPi: firstSettledByPi },
        duplicate: { receipt: duplicateReceipt, wait: duplicateWait },
        userTextsInTranscript: userTexts,
        recordsOfFirst,
        slow: { receipt: slowReceipt, pendingWhileStreaming, sessionsWhileStreaming, abortOfUnknownOperation, abortOfStreamingOperation,
          settledByPi: slowSettledByPi, wait: slowWait, records: recordsOfSlow },
        fauxCalls: this.#faux.state.callCount,
        wrapperCalls: variant === "wrapped" ? { ...this.#calls } : undefined,
      };
    }
  };
}

export const GivenStore = routeClass("given");
export const WrappedStore = routeClass("wrapped");
export const MemoryStore = routeClass("memory");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [variant] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    const namespace = variant === "memory" ? env.MEMORY : variant === "wrapped" ? env.WRAPPED : env.GIVEN;
    return namespace.get(namespace.idFromName("route")).fetch(new Request("https://probe.internal/scenario", { method: "POST" }));
  },
};
