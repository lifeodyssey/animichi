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

describe("wranglerMain parses the config as wrangler does", () => {
  it.each([
    {
      case: "a JSONC block comment that spans lines and holds a main key",
      name: "wrangler.jsonc",
      text: '{\n  "name": "demo",\n  /*\n  "main": "x",\n  */\n  "main": "src/entry.ts"\n}\n',
      main: "src/entry.ts",
    },
    {
      case: "a JSONC line comment that names main after another key",
      name: "wrangler.jsonc",
      text: '{\n  "name": "n", // "main": "y"\n  "main": "src/entry.ts"\n}\n',
      main: "src/entry.ts",
    },
    {
      case: "an environment's main written before the top-level one",
      name: "wrangler.jsonc",
      text: '{ "env": { "staging": { "main": "z" } }, "main": "src/entry.ts" }\n',
      main: "src/entry.ts",
    },
    {
      case: "a TOML literal string",
      name: "wrangler.toml",
      text: "name = \"demo\"\nmain = 'src/index.ts'\n",
      main: "src/index.ts",
    },
    {
      case: "a TOML multi-line string holding a main line before the real key",
      name: "wrangler.toml",
      text: 'name = "demo"\ndescription = """\nmain = "fake.ts"\n"""\nmain = "src/index.ts"\n',
      main: "src/index.ts",
    },
  ])("reads the top-level main through $case", ({ name, text, main }) => {
    expect(wranglerMain(configFile(name, text))).toBe(main);
  });

  it("throws wrangler's ParseError, naming the file, for a config wrangler cannot parse", async () => {
    const path = configFile("wrangler.toml", 'name = "demo"\nmain = "src/index.ts\n');
    await expect(Promise.resolve().then(() => wranglerMain(path)))
      .rejects.toMatchObject({ name: "ParseError", location: { file: path } });
  });
});
