import { NextRequest, NextResponse } from "next/server";
import { createLoginToken } from "@/lib/auth-store";
import { sendLoginEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { isAdmin } from "@/lib/admin-store";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const email = getCurrentUser(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await isAdmin(email))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const targetEmail = typeof body.email === "string" ? body.email.trim() : "";
  if (!targetEmail) return NextResponse.json({ error: "email is required." }, { status: 400 });
  if (!env.resendApiKey) {
    return NextResponse.json(
      { error: "Email is not configured. Cannot send magic link." },
      { status: 503 }
    );
  }
  const result = await createLoginToken(targetEmail);
  if ("error" in result) {
    return NextResponse.json(
      { error: "Too many sign-in attempts for that email. Try again later." },
      { status: 429 }
    );
  }
  const { token, code } = result;
  const send = await sendLoginEmail({ to: targetEmail, token, code });
  if (!send.ok) {
    return NextResponse.json(
      { error: send.error ?? "Failed to send email." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, email: targetEmail });
}
