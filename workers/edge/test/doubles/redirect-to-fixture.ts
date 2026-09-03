// Emulates the one behaviour the W0-S5 redirect probe borrows from
// httpbingo.org: `/redirect-to?url=<target>` answers `302 Location: <target>`,
// and any other path answers a plain status.
//
// Truthful rather than scripted on purpose — the probe's three cases differ
// only in the `url` query they carry, so a double that ignored the query would
// let all three take the same path and prove nothing about re-validation.

import type { EgressFetch } from "../../src/agent/egress/guarded-fetch.ts";

export class RedirectToFixture {
  readonly requested: string[] = [];

  readonly fetch: EgressFetch = (input) => {
    const url = new URL(new Request(input).url);
    this.requested.push(url.toString());
    const target = url.searchParams.get("url");
    if (target === null) return Promise.resolve(new Response("teapot", { status: 418 }));
    return Promise.resolve(new Response(null, { status: 302, headers: { location: target } }));
  };
}
