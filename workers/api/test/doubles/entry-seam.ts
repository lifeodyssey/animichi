/**
 * The gateway's entry seam as the characterization pins drive it: Request in,
 * Response out, through the app the Worker exports.
 *
 * `src/entry.ts` default-exports `createWorkerApp({})`, but it cannot load under
 * `node --test`: its `SessionAgent` export imports `agents`, which imports
 * `cloudflare:workers`. So the pins build the same app through the same factory.
 * `bareSeam` injects nothing. `entrySeam` injects only the four hermetic seams
 * `WorkerDeps` documents — the identity verdict, the Turnstile check, the agent
 * tier and the adoption store — and each of them writes what it was asked into
 * the case's ordered log, beside the bindings of `entry-seam-bindings.ts`. Route
 * selection, the showcase gate, cookies, the limiter, the forwards, the proxies,
 * the envelopes and the request ID run as they do in production.
 *
 * Every case runs on a frozen clock (`NOW`), because the Turnstile pass below
 * was minted at that instant and is valid for five minutes after it.
 */
import type { TestContext } from "node:test";
import { createWorkerApp, type WorkerDeps } from "../../src/app.ts";
import type { Env } from "../../src/env.ts";
import { entryEnv, stubOutbound } from "./entry-seam-bindings.ts";
import { UNLIMITED, type LimiterPlan } from "./entry-seam-limiters.ts";

type WorkerApp = ReturnType<typeof createWorkerApp>;
type AgentTier = NonNullable<WorkerDeps["agentTurns"]>;
type Identity = Parameters<AgentTier["chat"]>[2];
type Verdict = Awaited<ReturnType<NonNullable<WorkerDeps["authenticate"]>>>;
type TurnstileCheck = NonNullable<WorkerDeps["turnstileGate"]>;
type AdoptionStore = NonNullable<WorkerDeps["sessionAdoption"]>;
type RequestHeaders = Readonly<Record<string, string>>;

export const ORIGIN = "https://api.animichi.test";
/** 2026-11-23T12:00:00Z. */
export const NOW = 1795435200000;

/** A signed anonymous id, minted by today's code under the fixed test key. */
export const AID = "aid=0123456789abcdef0123456789abcdef.80d26bb16b9d931cfd330fea2c8338f4941eebd9c3d3cafe0e52c04602744a23";
/** The same visitor's Turnstile pass, minted at `NOW` by today's code under the same key. */
export const PASS = "turnstile_pass=1795435500000.8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d2";
export const VISITOR = "anon_0123456789abcdef0123456789abcdef";
/** A returning visitor who has already solved the challenge. */
export const ADMITTED = { Cookie: `${AID}; ${PASS}` };

/** The bearer strings a case may present; any other value, or none, is an absent credential. */
export const HUMAN = { Authorization: "Bearer human-u1" };
export const INVALID = { Authorization: "Bearer invalid" };
export const UNVERIFIABLE = { Authorization: "Bearer unverifiable" };
/** The one Turnstile token the injected check accepts. */
export const SOLVED = { "cf-turnstile-response": "solved-token" };

type Labelled<T> = Readonly<{ label: string; value: T }>;

const VERDICTS: Readonly<Record<string, Labelled<Verdict>>> = {
  "Bearer human-u1": { label: "u1", value: { ok: true, userId: "u1", userType: "human" } },
  "Bearer invalid": { label: "invalid", value: { ok: false, reason: "invalid" } },
  "Bearer unverifiable": { label: "unverifiable", value: { ok: false, reason: "unverifiable", detail: "status 503" } },
};
const ABSENT: Labelled<Verdict> = { label: "absent", value: { ok: false, reason: "absent" } };

function verdicts(log: string[]): NonNullable<WorkerDeps["authenticate"]> {
  return (request) => {
    const verdict = VERDICTS[request.headers.get("Authorization") ?? ""] ?? ABSENT;
    log.push(`auth ${verdict.label}`);
    return Promise.resolve(verdict.value);
  };
}

const TURNSTILE_RESULTS: Readonly<Record<string, { ok: boolean; errorCodes: string[] }>> = {
  "solved-token": { ok: true, errorCodes: [] },
};
const UNSOLVED = { ok: false, errorCodes: ["invalid-input-response"] };

function turnstileCheck(log: string[]): TurnstileCheck {
  return {
    check: (token) => {
      log.push(`turnstile ${token ?? "-"}`);
      return Promise.resolve(TURNSTILE_RESULTS[token ?? ""] ?? UNSOLVED);
    },
  };
}

/** An agent tier that names the handler it was asked for, for whom, and for which session. */
function namingTier(log: string[]): AgentTier {
  const answer = (handler: string, identity: Identity, session = "-"): Promise<Response> => {
    log.push(`tier ${handler} ${identity.userId} ${identity.userType} ${session}`);
    return Promise.resolve(Response.json({ handler, user: identity.userId, type: identity.userType, session }));
  };
  return {
    chat: (_env, _request, identity) => answer("chat", identity),
    probe: (_request, identity) => answer("probe", identity),
    list: (_env, _request, identity) => answer("list", identity),
    transcript: (_env, _request, identity, session) => answer("transcript", identity, session),
    stream: (_env, _request, identity, session) => answer("stream", identity, session),
  };
}

function adoptionStore(log: string[]): AdoptionStore {
  return {
    adopt: (from, to) => {
      log.push(`adopt ${from} ${to}`);
      return Promise.resolve({ adopted: 1, noop_class: "adopted", revisions_bumped: 1 });
    },
  };
}

const EXECUTION = {
  waitUntil: (promise: Promise<unknown>) => { void promise; },
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

export interface EntrySeam {
  /** Every collaborator call the case's requests made, in order. */
  readonly log: string[];
  send(method: string, path: string, headers?: RequestHeaders): Promise<Response>;
}

function seamOver(app: WorkerApp, env: Partial<Env>, log: string[]): EntrySeam {
  return {
    log,
    send: (method, path, headers = {}) => Promise.resolve(app.request(`${ORIGIN}${path}`, { method, headers }, env, EXECUTION)),
  };
}

function prepared(t: TestContext): string[] {
  const log: string[] = [];
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  stubOutbound(t, log);
  return log;
}

/** The app with its four hermetic seams injected, over the recording bindings. */
export function entrySeam(t: TestContext, plan: LimiterPlan = UNLIMITED, vars: Readonly<Record<string, unknown>> = {}): EntrySeam {
  const log = prepared(t);
  const app = createWorkerApp({
    authenticate: verdicts(log), turnstileGate: turnstileCheck(log), agentTurns: namingTier(log), sessionAdoption: adoptionStore(log),
  });
  return seamOver(app, entryEnv(log, plan, vars), log);
}

/** The app exactly as `src/entry.ts` builds it, with nothing injected, over the same bindings. */
export function bareSeam(t: TestContext, plan: LimiterPlan = UNLIMITED, vars: Readonly<Record<string, unknown>> = {}): EntrySeam {
  const log = prepared(t);
  return seamOver(createWorkerApp({}), entryEnv(log, plan, vars), log);
}
