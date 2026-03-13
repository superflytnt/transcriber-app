import { env } from "./env";

/**
 * Sends the sign-in email with magic link and one-time code.
 * Last line of body must be exactly: @<domain> #<code> (one space) for Safari/Mail autofill.
 */
export async function sendLoginEmail(params: {
  to: string;
  token: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { to, token, code } = params;
  if (!env.resendApiKey) {
    console.warn("[email] RESEND_API_KEY not set; login email not sent.");
    return { ok: false, error: "Email not configured." };
  }
  const appUrl = (env.appUrl || "").trim() || "http://localhost:3000";
  if (!env.appUrl?.trim()) {
    console.warn("[email] APP_URL not set; login link may point to localhost.");
  }
  const verifyUrl = `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  const domain = new URL(appUrl).hostname;

  const humanReadable = `Sign in to Transcriber\n\nClick the link below to sign in:\n${verifyUrl}\n\nOr enter this code: ${code}\n\nThis code expires in 15 minutes.`;
  const lastLine = `@${domain} #${code}`;
  const textBody = `${humanReadable}\n\n${lastLine}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5;">
  <p>Sign in to Transcriber</p>
  <p><a href="${verifyUrl}">Click here to sign in</a></p>
  <p>Or enter this code: <strong>${code}</strong></p>
  <p>This code expires in 15 minutes.</p>
  <pre style="margin-top: 2em; font-size: 0; line-height: 0;">@${domain} #${code}</pre>
</body>
</html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.fromEmail,
        to: [to],
        subject: "Sign in to Transcriber",
        text: textBody,
        html: htmlBody,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[email] Resend error:", res.status, errText);
      let message = "Failed to send email.";
      try {
        const errJson = JSON.parse(errText) as { message?: string };
        if (typeof errJson?.message === "string" && errJson.message.trim()) {
          message = errJson.message;
        }
      } catch {
        // use default message
      }
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email]", err);
    const message = err instanceof Error ? err.message : "Failed to send email.";
    return { ok: false, error: message };
  }
}
