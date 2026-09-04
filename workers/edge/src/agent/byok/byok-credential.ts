/**
 * One caller's own provider credential, for exactly one turn (W2-3 #1289,
 * spec §四 S5's "非空 key / 无 server-key fallback / 日志脱敏").
 *
 * IN MEMORY ONLY. This object travels request → intake → the session's Durable
 * Object heap → the turn's model, and touches nothing durable on the way:
 * never a `messages`, `runs` or `run_steps` column, never `ctx.storage`, never
 * a cache. The turn that used it ends and it is gone.
 *
 * THE PLAINTEXT IS BEHIND A PRIVATE FIELD, which is not decoration. A `#`
 * field is invisible to `JSON.stringify`, to `util.inspect` and therefore to
 * `console.warn(credential)` — measured on this repo's Node, and the reason
 * `toJSON` below can be the whole of what a log ever sees. That is
 * defence in depth behind `SecretScrub`, the same layering
 * `byok_models.py`'s `field(repr=False)` gives the Python side: the scrub
 * catches the value wherever it ends up as text, this catches the OBJECT
 * being logged whole.
 */
import type { EgressDenyReason } from "../egress/egress-decision.ts";
import type { ByokProvider } from "../egress/provider-allowlist.ts";
import type { ByokFamily } from "./byok-family.ts";

/**
 * The taxonomy a rejected credential is answered with. Ported from
 * `byok_models.py::ByokErrorCode` plus the probe route's `egress_blocked`
 * (`interfaces/services/byok_probe.py`), which is a distinct code precisely so
 * "you sent no base_url" and "your base_url is not somewhere we will talk to"
 * are not the same answer.
 */
export type ByokRejectionCode = "invalid_request" | "egress_blocked";

/**
 * A typed, no-fallback BYOK refusal. `message` is safe to surface — it never
 * embeds the submitted key or base URL — and `reason` carries the egress
 * verdict for a LOG, deliberately not for the wire: telling a caller which
 * red line their URL tripped refines an SSRF oracle, and Python collapses
 * every egress refusal to one sentence for that reason.
 */
export class ByokRejection extends Error {
  readonly code: ByokRejectionCode;
  readonly reason: EgressDenyReason | null;

  constructor(code: ByokRejectionCode, message: string, reason: EgressDenyReason | null = null) {
    super(message);
    this.name = "ByokRejection";
    this.code = code;
    this.reason = reason;
  }
}

export interface ByokCredentialParts {
  readonly family: ByokFamily;
  readonly provider: ByokProvider;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly secret: string;
}

/** What a credential is willing to say about itself in a log or a span. */
export interface ByokCredentialDigest {
  readonly family: ByokFamily;
  readonly provider: ByokProvider;
  readonly model: string;
}

export class ByokCredential {
  readonly family: ByokFamily;
  /** The egress allowlist family, already translated from `family`. */
  readonly provider: ByokProvider;
  /** Validated by `EgressPolicy` before this object could be constructed. */
  readonly baseUrl: string;
  readonly modelId: string;
  readonly #secret: string;

  constructor(parts: ByokCredentialParts) {
    this.family = parts.family;
    this.provider = parts.provider;
    this.baseUrl = parts.baseUrl;
    this.modelId = parts.modelId;
    this.#secret = parts.secret;
  }

  /** The plaintext, for the two callers allowed to hold it: the model this
   * turn streams through, and the scrub that redacts it out of that turn's
   * text. Nothing else may read it. */
  get secret(): string {
    return this.#secret;
  }

  /** Every serialiser goes through here, so none of them can reach the key. */
  toJSON(): ByokCredentialDigest {
    return { family: this.family, provider: this.provider, model: this.modelId };
  }

  toString(): string {
    return `ByokCredential(${this.family}/${this.modelId})`;
  }
}
