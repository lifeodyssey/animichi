import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wranglerMain } from "../scripts/wrangler-main";

/**
 * `wranglerMain` (scripts/wrangler-main.ts): the `main` a wrangler config file
 * declares, which the entry-export check reads for every config under workers/*
 * and apps/*. Each case writes one config to a temporary directory and reads it.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wrangler-main-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Write `text` as the config file `name` in this case's directory; its path. */
function configFile(name: string, text: string): string {
  const path = join(root, name);
  writeFileSync(path, text, "utf8");
  return path;
}

describe("wranglerMain reads main from a config file", () => {
  it("reads main from toml and jsonc without hard-coding the entry filename", () => {
    expect(wranglerMain(configFile("wrangler.toml", 'main = "src/entry.ts"\n'))).toBe("src/entry.ts");
    expect(wranglerMain(configFile("wrangler.jsonc", '{ "main": ".output/server/index.mjs" }\n'))).toBe(
      ".output/server/index.mjs",
    );
  });

  it("does not treat a JSONC whole-line block comment as wrangler main", () => {
    const path = configFile("wrangler.jsonc", '/* "main": "commented.ts" */\n{ "main": "src/entry.ts" }\n');
    expect(wranglerMain(path)).toBe("src/entry.ts");
  });

  it("fails closed when the only jsonc main key is inside a block comment", () => {
    expect(wranglerMain(configFile("wrangler.jsonc", '/* "main": "commented.ts" */\n{ "name": "x" }\n'))).toBeUndefined();
  });
});
