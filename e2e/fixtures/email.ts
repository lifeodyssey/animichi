/**
 * Unified email fixture for E2E tests.
 * - Local (supabase start): reads from Mailpit at localhost:54324
 * - CI/Remote: reads from mails.dev via CLI
 *
 * Set E2E_EMAIL_PROVIDER=mails to use mails.dev, otherwise defaults to Mailpit.
 */
import { execFileSync } from "node:child_process";

const PROVIDER = process.env.E2E_EMAIL_PROVIDER || "mailpit";
const MAILPIT_URL = process.env.MAILPIT_URL || "http://localhost:54324";
const POLL_INTERVAL = 1_500;
const MAX_WAIT = 20_000;

export interface ReceivedEmail {
  subject: string;
  html: string;
  text: string;
}

// ── Mailpit (local) ──

async function waitMailpit(toAddress: string, since: Date): Promise<ReceivedEmail> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const data = (await res.json()) as {
      messages: { ID: string; To: { Address: string }[]; Created: string }[];
    };
    const match = data.messages.find(
      (m) => m.To.some((t) => t.Address === toAddress) && new Date(m.Created) > since,
    );
    if (match) {
      const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const msg = (await detail.json()) as { Subject: string; HTML: string; Text: string };
      return { subject: msg.Subject, html: msg.HTML, text: msg.Text };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`No email to ${toAddress} in Mailpit within ${MAX_WAIT / 1000}s`);
}

// ── mails.dev (remote) ──

async function waitMails(since: Date): Promise<ReceivedEmail> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    try {
      const raw = execFileSync("mails", ["inbox", "--json", "--limit", "1"], {
        encoding: "utf-8",
        timeout: 10_000,
      });
      const messages = JSON.parse(raw) as { subject: string; html: string; text: string; date: string }[];
      if (messages.length > 0 && new Date(messages[0].date) > since) {
        return { subject: messages[0].subject, html: messages[0].html, text: messages[0].text };
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`No email received via mails.dev within ${MAX_WAIT / 1000}s`);
}

// ── Public API ──

export async function waitForEmail(toAddress: string, since: Date): Promise<ReceivedEmail> {
  if (PROVIDER === "mails") return waitMails(since);
  return waitMailpit(toAddress, since);
}

export function extractMagicLink(html: string): string {
  // Match /auth/confirm or /auth/callback link, or GoTrue verify link
  const patterns = [
    /href="([^"]*\/auth\/confirm[^"]*)"/,
    /href="([^"]*\/auth\/callback[^"]*)"/,
    /href="([^"]*\/auth\/v1\/verify[^"]*)"/,
  ];
  for (const p of patterns) {
    const match = html.match(p);
    if (match) return match[1].replace(/&amp;/g, "&");
  }
  throw new Error("No magic link found in email HTML");
}

export function verifyEmailLocale(html: string, locale: "ja" | "zh" | "en"): boolean {
  const markers: Record<string, string[]> = {
    ja: ["ログイン", "聖地巡礼"],
    zh: ["登录", "聖地巡礼"],
    en: ["Log in", "Seichijunrei"],
  };
  return markers[locale].every((m) => html.includes(m));
}

export function getTestEmail(): string {
  if (PROVIDER === "mails") {
    return process.env.MAILS_DEV_MAILBOX || "seichijunreiqa@mails.dev";
  }
  return `e2e-${Date.now()}@seichijunrei.test`;
}
