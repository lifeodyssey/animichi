import type { MutableModels } from "@earendil-works/pi-ai";
import { KeyLiterals } from "../egress/key-literals.ts";
import type { nativeByokModels } from "./native-models.ts";

export type CredentialModels = Awaited<ReturnType<typeof nativeByokModels>>;

/**
 * The BYOK credentials one SessionAgent incarnation holds, keyed by operation ID. They live only in the DO heap,
 * until settlement releases each one.
 */
export class OperationCredentials {
  readonly #bound = new Map<string, CredentialModels>();

  get(operationId: string) { return this.#bound.get(operationId); }
  has(operationId: string) { return this.#bound.has(operationId); }
  bind(operationId: string, credential: CredentialModels) { this.#bound.set(operationId, credential); }

  /** Every key a stored write must not hold: the literal of each credential still bound. */
  literals() { return KeyLiterals.union([...this.#bound.values()].map((credential) => credential.literals)); }

  /**
   * Logs the operation's credential out, forgets it, and removes its provider from the session's models. The provider
   * holds the key as well, so both go even when the logout throws; the logout's error still reaches the caller.
   */
  async release(operationId: string, providers: Pick<MutableModels, "deleteProvider">) {
    const credential = this.#bound.get(operationId);
    if (!credential) return;
    try {
      await credential.models.logout(credential.model.provider);
    } finally {
      this.#bound.delete(operationId);
      providers.deleteProvider(credential.model.provider);
    }
  }
}
