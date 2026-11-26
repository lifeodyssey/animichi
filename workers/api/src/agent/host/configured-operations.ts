import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { AdmissionOptions, ModelAdmissionRequest } from "../admission/types.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";
import type { SecretScrub } from "../egress/secret-scrub.ts";
import { admitConfiguredModel, configuredReplayRequest } from "./configured-admission.ts";
import type { NativeSessionResources } from "./native-bootstrap.ts";
import { operationToolsContext } from "./operation-tool-settings.ts";
import { prepareAuthorizedDrive } from "./prepare-authorized-drive.ts";
import type { ModelOperations } from "./session-domain.ts";

/**
 * The deployed host's model operations, over the resources domain startup opened from Env. An operation's
 * BYOK models live only in the resources' credentials, in the DO heap and keyed by operation ID, until its
 * settlement releases them; the session store redacts every key still bound there.
 */
export class ConfiguredOperations implements ModelOperations {
  readonly #resources: NativeSessionResources;

  constructor(resources: NativeSessionResources) {
    this.#resources = resources;
  }

  admit(session: Session, lane: AgentLane, context: Context, request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts) {
    return admitConfiguredModel(this.#resources, this.#resources.credentials, session, lane, context, request, options, credential);
  }

  replayRequest(request: ModelAdmissionRequest, credential?: ByokCredentialParts) {
    return configuredReplayRequest(this.#resources, request, credential);
  }

  prepareDrive(session: Session, lane: AgentLane, operationId: string, context: Context) {
    return prepareAuthorizedDrive(this.#resources, this.#resources.credentials.has(operationId), session, lane, operationId, context);
  }

  driveContext(session: Session, operationId: string, context: Context) {
    return operationToolsContext(this.#resources, this.#resources.credentials, session, operationId, context);
  }

  scrub(operationId: string): SecretScrub {
    return this.#resources.credentials.get(operationId)?.scrub ?? this.#resources.server.scrub;
  }

  /** Terminal settlement logs the operation's BYOK credential out and removes its provider, even when the logout throws. */
  release(operationId: string) {
    return this.#resources.credentials.release(operationId, this.#resources.server.models);
  }
}
