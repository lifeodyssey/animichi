import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import type { AdmissionDatabase } from "../src/agent/admission/types.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";
import type { ModelOperations } from "../src/agent/host/session-domain.ts";
import { prepareModelOperation } from "../src/agent/recovery/prepare-model-operation.ts";

/**
 * Model operations for a host that supplies its own models: admission and drive preparation go through the
 * business database alone, with no Env-configured models, BYOK credentials or tool authority. A drive runs
 * under the caller's Context, a watch scrubs nothing, and settlement has nothing to release.
 */
export function businessOperations(db: AdmissionDatabase): ModelOperations {
  return {
    admit: (_session, lane, context, request, options) => admitModelRequest(db, lane, context, request, options),
    replayRequest: (request) => Promise.resolve(request),
    prepareDrive: (session, lane, operationId, context) => prepareModelOperation(db, session, lane, operationId, context),
    driveContext: (_session, _operationId, context) => Promise.resolve(context),
    scrub: () => new SecretScrub(),
    release: () => Promise.resolve(),
  };
}
