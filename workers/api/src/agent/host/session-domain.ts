import type { AgentHarnessOptions, AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMetadata, SessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import type { PilgrimageToolContext } from "@animichi/agent/tools";
import type { AdmissionDatabase, AdmissionOptions, ModelAdmissionOutcome, ModelAdmissionRequest } from "../admission/types.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";
import type { SecretScrub } from "../egress/secret-scrub.ts";

/** How a harness is composed around one opened session. */
export type Composition = (session: Session) => Omit<AgentHarnessOptions<PilgrimageToolContext>, "session" | "tools">;

/**
 * How a host admits, prepares, drives and releases its model operations. The deployed host's are
 * `ConfiguredOperations`: Env-configured models, an operation's BYOK credential, and the tool authority
 * every drive rechecks.
 */
export interface ModelOperations {
  admit(session: Session, lane: AgentLane, context: Context, request: ModelAdmissionRequest,
    options: AdmissionOptions, credential?: ByokCredentialParts): Promise<ModelAdmissionOutcome>;
  /** The request a read-only replay compares, as admission would have configured it. */
  replayRequest(request: ModelAdmissionRequest, credential?: ByokCredentialParts): Promise<ModelAdmissionRequest>;
  /** Whether the operation may be driven now, once its witnesses and authority are read. */
  prepareDrive(session: Session, lane: AgentLane, operationId: string, context: Context): Promise<boolean>;
  /** The Context a drive of the operation runs under. */
  driveContext(session: Session, operationId: string, context: Context): Promise<Context>;
  /** What scrubs the operation's secrets from the watch a client reads. */
  scrub(operationId: string): SecretScrub;
  /** Release what the operation held, once it is settled. */
  release(operationId: string): Promise<void>;
}

/** Everything one SessionAgent incarnation runs against, bound once by domain startup. */
export interface SessionDomain {
  readonly repo: SessionRepo;
  readonly metadata: SessionMetadata;
  readonly compose: Composition;
  /** What admission, recovery and settlement read and write, and where a spent turn's refusal is recorded. */
  readonly business: AdmissionDatabase;
  readonly operations: ModelOperations;
}
