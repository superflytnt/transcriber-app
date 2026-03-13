import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createLoginToken } from "@/lib/auth-store";
import { sendLoginEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (!env.resendApiKey) {
      return NextResponse.json(
        {
          error: "Email is not configured on this server. Sign-in links cannot be sent.",
          code: "EMAIL_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !env.appUrl?.trim()) {
      return NextResponse.json(
        {
          error: "APP_URL is not set. Set APP_URL to your app's URL (e.g. https://yourapp.up.railway.app) so login links work.",
          code: "APP_URL_NOT_SET",
        },
        { status: 503 }
      );
    }
    const result = await createLoginToken(email);
    if ("error" in result) {
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please try again in a few minutes." },
        { status: 429 }
      );
    }
    const { token, code } = result;
    const send = await sendLoginEmail({ to: email, token, code });
    if (!send.ok) {
      return NextResponse.json(
        { error: send.error ?? "We couldn't send the email. Please try again." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/auth/send-link]", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
