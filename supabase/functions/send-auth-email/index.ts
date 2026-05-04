// supabase/functions/send-auth-email/index.ts
//
// Auth Hook: intercepts all Supabase auth emails and sends locale-aware
// versions. Registered as auth.send_email hook in Supabase Dashboard.
//
// User locale is set during signInWithOtp() via data: { locale }.
// Falls back to "en" if no locale is set.

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

function buildHtml(locale: string, confirmUrl: string): string {
  const t = TEMPLATES[locale] ?? TEMPLATES.en;

  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #f8fafc;">
  <div style="text-align: center; margin-bottom: 32px;">
    <svg viewBox="0 0 72 72" width="36" height="36" style="display: inline-block;">
      <rect x="12" y="16" width="48" height="5" rx="2.5" fill="#c0392b"/>
      <rect x="8" y="14" width="56" height="3" rx="1.5" fill="#c0392b"/>
      <rect x="16" y="21" width="5" height="35" rx="1" fill="#c0392b"/>
      <rect x="51" y="21" width="5" height="35" rx="1" fill="#c0392b"/>
      <rect x="12" y="30" width="48" height="3" rx="1.5" fill="#c0392b" opacity=".5"/>
    </svg>
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeRedirect(to: string | undefined): string {
  if (!to || !to.startsWith("/") || to.startsWith("//")) return "/chat";
  return to;
}

Deno.serve(async (req) => {
  const payload = (await req.json()) as AuthEmailPayload;
  const locale = payload.user.user_metadata.locale ?? "en";
  const t = TEMPLATES[locale] ?? TEMPLATES.en;

  const { token_hash, redirect_to, email_action_type } = payload.email_data;
  const safeTarget = safeRedirect(redirect_to);
  const confirmUrl = `${SITE_URL}/auth/confirm?token_hash=${token_hash}&type=${email_action_type}&redirect=${encodeURIComponent(safeTarget)}`;

  const html = buildHtml(locale, escapeHtml(confirmUrl));

  // Use Supabase's built-in email sending by returning the email content.
  // The hook response tells Supabase to send the email with our custom content.
  return new Response(
    JSON.stringify({
      email: {
        subject: t.subject,
        body: html,
        content_type: "text/html",
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
