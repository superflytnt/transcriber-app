import { NextRequest, NextResponse } from "next/server";
import { signSession, sessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";

/** Set session for the given email without sending email. Allowed so new users can register (e.g. on Railway) without email delivery. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  const cookie = sessionCookieHeader(signSession(email));
  return NextResponse.json({ ok: true, email }, { headers: { "Set-Cookie": cookie } });
}
