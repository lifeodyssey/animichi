/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_ORIGIN } from "../../../src/features/seo/site";

/**
 * Guards `apps/web/public/*` — the crawler-facing static files.
 *
 * These assertions live in `apps/web` (not `apps/agent`) so the files under
 * test sit inside this package's own CI trigger path: a change to
 * `apps/web/public/**` can never land without this suite running.
 */
/**
 * Path arithmetic goes through `node:path`, never `new URL(rel, base)`: this
 * suite runs under jsdom (for `DOMParser`), whose `URL` ignores a `file://`
 * base and silently re-resolves against the document origin.
 */
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../public");

function publicPath(name: string): string {
  return join(PUBLIC_DIR, name);
}

function readPublic(name: string): string {
  return readFileSync(publicPath(name), "utf8");
}

const TRAINING_CRAWLERS = ["GPTBot", "ClaudeBot", "Google-Extended"];
const CITATION_CRAWLERS = [
  "OAI-SearchBot",
  "Claude-SearchBot",
  "Claude-User",
  "ChatGPT-User",
  "PerplexityBot",
];

/**
 * The directive lines a robots.txt `User-agent:` line opens, up to the next
 * blank line. Whole lines, not substrings: `Disallow: /v1/` starts with
 * `Disallow: /` and a substring match would read as a site-wide block.
 */
function directivesFor(robots: string, userAgent: string): string[] {
  const lines = robots.split(/\n\s*\n/u).map((block) => block.split("\n"));
  const group = lines.find((block) => block.includes(`User-agent: ${userAgent}`));
  if (group === undefined) throw new Error(`no robots.txt group for ${userAgent}`);
  return group.filter((line) => !line.startsWith("User-agent:"));
}

describe("robots.txt", () => {
  const robots = readPublic("robots.txt");

  it.each(TRAINING_CRAWLERS)("blocks the training crawler %s from the whole site", (bot) => {
    expect(directivesFor(robots, bot)).toContain("Disallow: /");
    expect(directivesFor(robots, bot)).not.toContain("Allow: /");
  });

  it.each(CITATION_CRAWLERS)("lets the citation crawler %s reach the site", (bot) => {
    expect(directivesFor(robots, bot)).toContain("Allow: /");
  });

  it("keeps the same-origin API out of the index for general crawlers", () => {
    expect(directivesFor(robots, "*")).toContain("Disallow: /v1/");
  });

  it("points at the sitemap on the canonical origin", () => {
    expect(robots).toContain(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`);
  });
});

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

describe("sitemap.xml", () => {
  const doc = new DOMParser().parseFromString(readPublic("sitemap.xml"), "application/xml");

  it("is well-formed XML in the sitemaps 0.9 namespace", () => {
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.namespaceURI).toBe(SITEMAP_NS);
  });

  it("lists the canonical home URL", () => {
    const locs = Array.from(doc.getElementsByTagNameNS(SITEMAP_NS, "loc"), (n) => n.textContent);
    expect(locs).toEqual([`${CANONICAL_ORIGIN}/`]);
  });

  it("carries every hreflang alternate on the home entry", () => {
    const links = Array.from(doc.getElementsByTagNameNS(XHTML_NS, "link"));
    expect(links.map((link) => link.getAttribute("hreflang"))).toEqual(["ja", "zh", "en", "x-default"]);
    expect(links.every((link) => link.getAttribute("href") === `${CANONICAL_ORIGIN}/`)).toBe(true);
  });
});

describe("llms.txt", () => {
  const llms = readPublic("llms.txt");

  it("opens with the llms.txt v1 H1 + summary blockquote", () => {
    const [heading, blank, summary] = llms.split("\n");
    expect(heading).toBe("# Animichi");
    expect(blank).toBe("");
    expect(summary?.startsWith("> ")).toBe(true);
  });

  it("links the canonical home URL so agents resolve the right origin", () => {
    expect(llms).toContain(`](${CANONICAL_ORIGIN}/)`);
  });
});

describe("og-image.png", () => {
  const bytes = readFileSync(publicPath("og-image.png"));

  it("is a non-empty real PNG, so the OG card can never 404 silently", () => {
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("is the 1200x630 card the OG meta declares", () => {
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});
