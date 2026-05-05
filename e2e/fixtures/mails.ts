import { execFileSync } from "node:child_process";

const MAILBOX = process.env.MAILS_DEV_MAILBOX || "seichijunreiqa@mails.dev";
const POLL_INTERVAL = 2_000;
const MAX_WAIT = 30_000;

interface MailMessage {
  id: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  date: string;
}

/**
 * Wait for a new email to arrive at the mails.dev inbox.
 * Polls `mails inbox` CLI until a message newer than `since` appears.
 */
export async function waitForEmail(since: Date): Promise<MailMessage> {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    try {
      const raw = execFileSync("mails", ["inbox", "--json", "--limit", "1"], {
        encoding: "utf-8",
        timeout: 10_000,
      });
      const messages = JSON.parse(raw) as MailMessage[];
      if (messages.length > 0) {
        const msg = messages[0];
        if (new Date(msg.date) > since) return msg;
      }
    } catch {
      // CLI may fail if no messages yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(`No email received at ${MAILBOX} within ${MAX_WAIT / 1000}s`);
}

/**
 * Extract the magic link URL from email HTML content.
 * Looks for the /auth/confirm link in the email body.
 */
export function extractMagicLink(html: string): string {
  const match = html.match(/href="([^"]*\/auth\/confirm[^"]*)"/);
  if (!match) throw new Error("No magic link found in email HTML");
  return match[1].replace(/&amp;/g, "&");
}

/**
 * Check if the email body contains text in the expected locale.
 */
export function verifyEmailLocale(
  html: string,
  locale: "ja" | "zh" | "en",
): boolean {
  const markers: Record<string, string[]> = {
    ja: ["ログイン", "聖地巡礼"],
    zh: ["登录", "聖地巡礼"],
    en: ["Log in", "Seichijunrei"],
  };
  return markers[locale].every((m) => html.includes(m));
}

export { MAILBOX };
