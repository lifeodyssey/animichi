import * as cloudflare from "@pulumi/cloudflare";
import { accountId, edgeKnobsNamespaceTitle } from "./config.ts";

/**
 * The edge Worker's runtime-knob store (#688). Pulumi owns the namespace —
 * never hand-created — so its id is a stack output rather than a dashboard
 * value, and `protect` keeps a stray destroy from discarding the operator's
 * tuned values.
 *
 * The wrangler binding that consumes this id is a stacked follow-up: a KV
 * namespace id exists only after the first apply of this resource, and the
 * binding lives in `workers/edge/wrangler.toml`, which cannot reference a
 * Pulumi output.
 */
export const edgeKnobsNamespace = new cloudflare.WorkersKvNamespace(
  "edge-knobs",
  { accountId, title: edgeKnobsNamespaceTitle },
  { protect: true },
);
