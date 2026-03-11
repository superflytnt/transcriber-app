import { NextRequest, NextResponse } from "next/server";
import { signSession, sessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Only in development: set session for the given email without sending email. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDev()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  const cookie = sessionCookieHeader(signSession(email));
  return NextResponse.json({ ok: true, email }, { headers: { "Set-Cookie": cookie } });
}
