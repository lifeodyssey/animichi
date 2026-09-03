// A truthful `fetch` double for the BYOK guarded fetch (W0-S5, #1248).
//
// Truthful in the sense the guard's tests need: it returns real `Response`
// objects with real status codes and real `Location` headers, and it records
// the URL and the `RequestInit` it was handed — so a test can assert both what
// the guard refused to send AND that it asked for `redirect: "manual"`. A
// double that just resolved a `{status}` literal would let the wrapper stop
// passing `manual` without a single test noticing.

import type { EgressFetch } from "../../src/agent/egress/guarded-fetch.ts";

export interface EgressCall {
  readonly url: string;
  readonly method: string;
  readonly redirect: string;
  readonly body: string;
  /** `""` when the hop carried no `Authorization` header. */
  readonly authorization: string;
}

/** One scripted answer: a redirect to `location`, or a terminal status + body. */
export interface ScriptedAnswer {
  status: number;
  location?: string;
  body?: string;
}

export class ScriptedEgressFetch {
  readonly calls: EgressCall[] = [];
  private readonly answers: ScriptedAnswer[];

  constructor(answers: readonly ScriptedAnswer[]) {
    this.answers = [...answers];
  }

  readonly fetch: EgressFetch = async (input, init) => {
    this.calls.push(await callOf(input, init));
    const answer = this.nextAnswer();
    const body = answer.body ?? "scripted";
    return new Response(body, { status: answer.status, headers: headersOf(answer) });
  };

  /** The last scripted answer repeats, so an SDK retry does not fall off the end. */
  private nextAnswer(): ScriptedAnswer {
    const answer = this.answers[0] ?? { status: 200 };
    if (this.answers.length > 1) this.answers.shift();
    return answer;
  }

  get urls(): string[] {
    return this.calls.map((call) => call.url);
  }
}

function headersOf(answer: ScriptedAnswer): Record<string, string> {
  const contentType = { "content-type": "application/json" };
  if (answer.location === undefined) return contentType;
  return { ...contentType, location: answer.location };
}

async function callOf(input: RequestInfo | URL, init?: RequestInit): Promise<EgressCall> {
  const request = new Request(input, init);
  const bodiless = request.method === "GET" || request.method === "HEAD";
  return {
    url: request.url,
    method: request.method,
    redirect: init?.redirect ?? "follow",
    body: bodiless ? "" : await request.text(),
    authorization: request.headers.get("authorization") ?? "",
  };
}
