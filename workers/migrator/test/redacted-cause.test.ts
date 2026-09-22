import { describe, expect, it } from "vitest";
import { redactedCause } from "../src/redacted-cause";

/* Which credential shapes `redactedCause` actually removes, and what it must leave alone.
 *
 * `migrate.worker.thrown.test.ts` owns the wiring — that both catch sites run their thrown value
 * through this module and log as well as return it. This file owns the rules themselves, because
 * the module shipped catching two shapes while its docblock promised "never a DSN, a credential
 * or a connection string": `password='x'`, `password="x"`, `"password":"x"`, `password: x` and a
 * schemeless `user:pass@host` all came through intact, into a CD log of a public repository.
 *
 * Every row asserts the WHOLE line rather than the absence of the secret. A rule that returned
 * the empty string would satisfy "the password is gone" and destroy the one thing #1868 exists
 * to deliver, so each expectation carries the surviving text with it.
 */

/** Recognisable, and worth nothing: the secret scanner runs on every commit. */
const PLACEHOLDER = "REDACT_ME_PLACEHOLDER";

const CREDENTIAL_SHAPES = [
  {
    shape: "a PostgreSQL URL, host and role with it",
    thrown: `connect postgresql://migrator:${PLACEHOLDER}@host/db failed`,
    redacted: "connect postgresql://[redacted] failed",
  },
  {
    shape: "a keyword DSN's unquoted value",
    thrown: `host=h password=${PLACEHOLDER} user=m`,
    redacted: "host=h password=[redacted] user=m",
  },
  {
    shape: "a single-quoted value",
    thrown: `conn invalid: password='${PLACEHOLDER}' rejected`,
    redacted: "conn invalid: password=[redacted] rejected",
  },
  {
    shape: "a double-quoted value",
    thrown: `conn invalid: password="${PLACEHOLDER}" rejected`,
    redacted: "conn invalid: password=[redacted] rejected",
  },
  {
    shape: "a JSON pair, whose key is quoted too",
    thrown: `cfg {"password":"${PLACEHOLDER}"} bad`,
    redacted: "cfg {\"password\":[redacted]} bad",
  },
  {
    shape: "a colon separator instead of an equals",
    thrown: `auth failed, password: ${PLACEHOLDER}`,
    redacted: "auth failed, password: [redacted]",
  },
  {
    shape: "a URI parameter, stopping at the ampersand",
    thrown: `?password=${PLACEHOLDER}&sslmode=require rejected`,
    redacted: "?password=[redacted]&sslmode=require rejected",
  },
  {
    shape: "userinfo a driver printed without its scheme",
    thrown: `cannot reach migrator:${PLACEHOLDER}@ep-x.neon.tech/neondb`,
    redacted: "cannot reach [redacted]",
  },
  {
    shape: "userinfo whose secret contains a slash",
    thrown: `cannot reach migrator:ab/cd+ef${PLACEHOLDER}@ep-x.neon.tech/db`,
    redacted: "cannot reach [redacted]",
  },
  {
    shape: "an environment variable, prefix and case intact",
    thrown: `env PGPASSWORD=${PLACEHOLDER} unset`,
    redacted: "env PGPASSWORD=[redacted] unset",
  },
] as const;

describe("shapes a credential arrives in", () => {
  it.each(CREDENTIAL_SHAPES)("redacts $shape", ({ thrown, redacted }) => {
    expect(redactedCause(new Error(thrown))).toBe(redacted);
  });

  it("redacts a thrown value that is not an Error at all", () => {
    expect(redactedCause(`password=${PLACEHOLDER}`)).toBe("password=[redacted]");
  });
});

/*
 * The other way to fail. A guard widened until it eats the driver's message returns the opacity
 * #1868 was opened to remove, and these are the near-misses that invite it: an `@` with no
 * credential, a keyword pair that is not a password, and a colon and an at-sign in plain prose.
 *
 * The load-bearing row is PostgreSQL's own authentication failure, the most frequent message this
 * module will ever see. It survives only because the rule requires a separator immediately after
 * the key, and the next character there is a space — so whoever one day accepts whitespace as a
 * separator turns the commonest error in the system into `password [redacted]`.
 */
const TEXT_THAT_MERELY_RESEMBLES_ONE = [
  { shape: "a URL carrying no userinfo", message: "connect https://ep-x.neon.tech/neondb failed" },
  { shape: "a keyword pair that is not a password", message: "timeout=30 retries=3 gave up" },
  { shape: "the word password with no value bound to it", message: "FATAL:  password authentication failed for user \"migrator\"" },
  { shape: "a colon and an at-sign in prose", message: "see runbook 12:30 at ops@animichi.com for details" },
  { shape: "a colon-and-at pair with no dot in the host", message: "[worker:migrator@v2] booted" },
  { shape: "an ssh remote, whose at-sign precedes its colon", message: "git@github.com:org/repo not found" },
  { shape: "a host and port with no at-sign", message: "P1001: Can't reach database server at ep-x.neon.tech:5432" },
  { shape: "Prisma naming its own failure", message: "P3009: migrate found failed migrations in the target database" },
  { shape: "the platform message this card exists to carry", message: "A call to blockConcurrencyWhile() in a Durable Object waited for too long." },
] as const;

describe("text that merely resembles a credential", () => {
  it.each(TEXT_THAT_MERELY_RESEMBLES_ONE)("keeps $shape word for word", ({ message }) => {
    expect(redactedCause(new Error(message))).toBe(message);
  });
});

/**
 * 185 puts `password='` at 185-194 and the secret at 195, straddling the 200-character cut: a
 * `slice` before the `replace` would hand the rules a value whose closing quote is gone, no
 * branch would match it, and the first five characters of the secret would be in the answer.
 */
const PADDING_TO_THE_CUT = "x".repeat(185);

describe("the cut at CAUSE_LIMIT", () => {
  it("cannot be used to smuggle a value past the rules", () => {
    const thrown = new Error(`${PADDING_TO_THE_CUT}password='${PLACEHOLDER}'`);
    expect(redactedCause(thrown)).toBe(`${PADDING_TO_THE_CUT}password=[redac`);
  });

  it("still ends a cause at 200 characters", () => {
    expect(redactedCause(new Error("y".repeat(500)))).toBe("y".repeat(200));
  });
});
