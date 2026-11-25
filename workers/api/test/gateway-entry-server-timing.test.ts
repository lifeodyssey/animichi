/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered, on the public popularity
 * read. Staging's catalog answers that read with a `Server-Timing` header (its database connect, its
 * query and its total), and the CD probe reads it through this gateway after a deploy
 * (`.github/scripts/catalog-first-request.sh`), so the gateway hands it on exactly as catalog sent it,
 * beside the request ID it adds.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/env.ts";
import { entrySeam } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";

const SERVER_TIMING = "db-connect;dur=48.0,db-query;dur=21.0,total;dur=75.0";

/** Catalog's answer to the read on staging: a ranking, timed. */
const TIMED_CATALOG: Env["CATALOG"] = {
  fetch: () => Promise.resolve(Response.json({ bangumi: [] }, { headers: { "Server-Timing": SERVER_TIMING } })),
};

void test("the public popularity read hands on catalog's Server-Timing unchanged", async (t) => {
  const seam = entrySeam(t, UNLIMITED, { CATALOG: TIMED_CATALOG });
  const response = await seam.send("GET", "/catalog/public/popular");
  assert.equal(response.status, 200);
  assert.ok(response.headers.has("X-Request-Id"));
  assert.equal(response.headers.get("Server-Timing"), SERVER_TIMING);
});
