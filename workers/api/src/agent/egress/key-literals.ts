/**
 * The BYOK keys bound to a session's operations, as the literals a stored write must never hold.
 */
export class KeyLiterals {
  static readonly NONE = new KeyLiterals([]);
  readonly #secrets: readonly string[];

  constructor(secrets: readonly string[]) {
    this.#secrets = secrets.map((secret) => secret.trim()).filter((secret) => secret.length > 0);
  }

  static union(sets: readonly KeyLiterals[]): KeyLiterals {
    return new KeyLiterals(sets.flatMap((set) => set.#secrets));
  }

  get isEmpty(): boolean {
    return this.#secrets.length === 0;
  }

  text(value: string): string {
    return value;
  }

  value(value: unknown): unknown {
    return value;
  }

  heldTail(_text: string): number {
    return 0;
  }
}
