/**
 * Mailpit API helper for local E2E testing.
 * Mailpit runs at localhost:54324 when using `supabase start`.
 */

const MAILPIT_URL = process.env.MAILPIT_URL || "http://localhost:54324";
const POLL_INTERVAL = 1_000;
const MAX_WAIT = 15_000;

interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string };
  To: { Address: string }[];
  Created: string;
  Snippet: string;
}

interface MailpitDetail {
  ID: string;
  Subject: string;
  HTML: string;
  Text: string;
}

/**
 * Wait for a new email sent to `toAddress` after `since`.
 */
export async function waitForMailpitEmail(
  toAddress: string,
  since: Date,
): Promise<MailpitDetail> {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const data = (await res.json()) as { messages: MailpitMessage[] };

    const match = data.messages.find(
      (m) =>
        m.To.some((t) => t.Address === toAddress) &&
        new Date(m.Created) > since,
    );

    if (match) {
      const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      return (await detail.json()) as MailpitDetail;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(
    `No email to ${toAddress} received in Mailpit within ${MAX_WAIT / 1000}s`,
  );
}

/**
 * Extract the magic link from Mailpit email HTML.
 */
export function extractMagicLink(html: string, baseUrl: string): string {
  // Mailpit emails from local Supabase use the site_url from config.toml
  const match = html.match(/href="([^"]*(?:\/auth\/confirm|token_hash)[^"]*)"/);
  if (!match) {
    // Fallback: look for the confirmation link pattern from default Supabase template
    const codeMatch = html.match(/href="([^"]*(?:token=|token_hash=)[^"]*)"/);
    if (!codeMatch) throw new Error("No magic link found in email HTML");
    return codeMatch[1].replace(/&amp;/g, "&");
  }
  return match[1].replace(/&amp;/g, "&");
}
