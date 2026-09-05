import { fileURLToPath } from 'node:url';

import type { BaselineLocation } from '../gate/baseline-store.ts';

/**
 * The Python-written record a TS staging run is gated against (W3-5 #1303).
 *
 * The layer and the model are PINNED here rather than exposed as flags. The
 * comparison this package exists to make is "the TS runner on staging against
 * the committed Python run of `agent_eval_v3`", and a gate whose baseline can
 * be pointed elsewhere on the command line can always be made to pass by
 * pointing it somewhere easier. Changing which record W3-5 compares against is
 * a change to this file, in a diff someone reads.
 *
 * These two names are what `baselinePath` flattens into
 * `baselines/agent_l4_trajectory_openai-mimo-v2.5-https---opencode.ai-zen-go-v1.json`
 * — `:`, `@` and `/` each become `-`.
 */
export const BASELINES_DIR = fileURLToPath(new URL('../../baselines/', import.meta.url));

/** `run_agent_eval._trajectory_target().layer` — the tier the record was written from. */
export const PYTHON_BASELINE_LAYER = 'agent_l4_trajectory';

/** The model that run used. The staging deploy answers with whatever model it
 * is configured with and publishes none of it on the wire, so this is the
 * baseline's identity, not a claim about what answered the TS turns. */
export const PYTHON_BASELINE_MODEL = 'openai:mimo-v2.5@https://opencode.ai/zen/go/v1';

export function pythonBaselineLocation(): BaselineLocation {
  return {
    layer: PYTHON_BASELINE_LAYER,
    modelId: PYTHON_BASELINE_MODEL,
    baselinesDir: BASELINES_DIR,
  };
}
