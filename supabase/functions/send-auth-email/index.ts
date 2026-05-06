// supabase/functions/send-auth-email/index.ts
//
// Auth Hook: sends locale-aware magic link emails.
// When send_email hook is enabled, GoTrue delegates ALL email sending
// to this function. We must actually send the email (not just return content).
//
// Local: sends via SMTP to Mailpit (localhost:54325 or Docker internal)
// Production: sends via Resend REST API

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface AuthEmailPayload {
  user: {
    email: string;
    user_metadata: {
      locale?: string;
    };
  };
  email_data: {
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
  };
}

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://seichijunrei.zhenjia.org";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "host.docker.internal";
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") ?? "54325");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER = Deno.env.get("SENDER_EMAIL") ?? "noreply@seichijunrei.zhenjia.org";

const TEMPLATES: Record<string, { subject: string; heading: string; cta: string; disclaimer: string }> = {
  ja: {
    subject: "聖地巡礼 — ログインリンク",
    heading: "ログイン",
    cta: "ログインする",
    disclaimer: "このメールに心当たりがない場合は無視してください。",
  },
  zh: {
    subject: "聖地巡礼 — 登录链接",
    heading: "登录",
    cta: "点击登录",
    disclaimer: "如果您没有请求此邮件，请忽略。",
  },
  en: {
    subject: "Seichijunrei — Login link",
    heading: "Log in",
    cta: "Log in",
    disclaimer: "If you didn't request this, please ignore this email.",
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeRedirect(to: string | undefined): string {
  if (!to || !to.startsWith("/") || to.startsWith("//")) return "/chat";
  return to;
}

function buildHtml(locale: string, confirmUrl: string): string {
  const t = TEMPLATES[locale] ?? TEMPLATES.en;
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #f8fafc;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 22px; margin: 8px 0 2px; color: #1a1a2e;">聖地巡礼</h1>
    <p style="color: #888; font-size: 12px; letter-spacing: 1.5px; margin: 0;">seichijunrei</p>
  </div>
  <p style="font-size: 15px; color: #333; margin-bottom: 24px;">${t.heading}</p>
  <a href="${confirmUrl}"
     style="display: inline-block; background: #7aade4; color: #1a3660; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
    ${t.cta} →
  </a>
  <p style="color: #aaa; font-size: 12px; margin-top: 32px; line-height: 1.6;">
    ${t.disclaimer}
  </p>
</body>
</html>`;
}

/** Send email via raw SMTP (for local Mailpit — no auth, no TLS). */
async function sendSmtp(to: string, subject: string, html: string): Promise<void> {
  const conn = await Deno.connect({ hostname: SMTP_HOST, port: SMTP_PORT });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function read(): Promise<string> {
    const buf = new Uint8Array(1024);
    const n = await conn.read(buf);
    return decoder.decode(buf.subarray(0, n ?? 0));
  }

  async function write(cmd: string): Promise<void> {
    await conn.write(encoder.encode(cmd + "\r\n"));
    await read();
  }

  await read(); // greeting
  await write(`EHLO localhost`);
  await write(`MAIL FROM:<${SENDER}>`);
  await write(`RCPT TO:<${to}>`);
  await write("DATA");

  const headers = [
    `From: 聖地巡礼 <${SENDER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    "",
    html,
    ".",
  ].join("\r\n");

  await conn.write(encoder.encode(headers + "\r\n"));
  await read();
  await write("QUIT");
  conn.close();
}

/** Send email via Resend REST API (for production). */
async function sendResend(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `聖地巡礼 <${SENDER}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error: ${res.status} ${body}`);
  }
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as AuthEmailPayload;
    const locale = payload.user.user_metadata.locale ?? "en";
    const t = TEMPLATES[locale] ?? TEMPLATES.en;
    const toEmail = payload.user.email;

    const { token_hash, redirect_to, email_action_type } = payload.email_data;
    const safeTarget = safeRedirect(redirect_to);
    const confirmUrl = `${SITE_URL}/auth/callback?token_hash=${token_hash}&type=${email_action_type}&redirect=${encodeURIComponent(safeTarget)}`;
    const html = buildHtml(locale, escapeHtml(confirmUrl));

    // Send the email
    if (RESEND_API_KEY) {
      await sendResend(toEmail, t.subject, html);
    } else {
      await sendSmtp(toEmail, t.subject, html);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-auth-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
