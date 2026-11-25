import { REDACTED } from "./secret-scrub.ts";

/** The key as written, and as written inside a JSON string. */
function storedForms(secret: string): string[] {
  const escaped = JSON.stringify(secret).slice(1, -1);
  return escaped === secret ? [secret] : [escaped, secret];
}

/** How many trailing characters of `text` begin `form`, short of all of it. */
function partialFormAt(text: string, form: string): number {
  for (let length = Math.min(form.length - 1, text.length); length > 0; length -= 1) {
    if (text.endsWith(form.slice(0, length))) return length;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The BYOK keys bound to a session's operations: the literals a stored write never holds. A session without a bound
 * key, or whose writes never hold it, stores exactly what it stored before.
 */
export class KeyLiterals {
  static readonly NONE = new KeyLiterals([]);
  readonly #secrets: readonly string[];
  readonly #forms: readonly string[];

  constructor(secrets: readonly string[]) {
    this.#secrets = secrets.map((secret) => secret.trim()).filter((secret) => secret.length > 0);
    this.#forms = [...new Set(this.#secrets.flatMap(storedForms))].sort((left, right) => right.length - left.length);
  }

  static union(sets: readonly KeyLiterals[]): KeyLiterals {
    return new KeyLiterals(sets.flatMap((set) => set.#secrets));
  }

  get isEmpty(): boolean {
    return this.#secrets.length === 0;
  }

  /** `value` with every form of every key replaced by the redaction marker. */
  text(value: string): string {
    return this.#forms.reduce((carried, form) => carried.split(form).join(REDACTED), value);
  }

  /** `value` with every string inside it redacted, property names included. */
  value(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((item: unknown) => this.value(item));
    return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [this.text(key), this.value(item)])) : value;
  }

  /** How many trailing characters of `text` could begin a key. */
  heldTail(text: string): number {
    return Math.max(0, ...this.#forms.map((form) => partialFormAt(text, form)));
  }
}
