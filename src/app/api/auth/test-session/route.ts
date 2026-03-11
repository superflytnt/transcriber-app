import { NextResponse } from "next/server";
import { signSession, sessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";

/** Only available when PLAYWRIGHT_TEST=1. Sets session cookie for e2e. */
export async function POST(): Promise<NextResponse> {
  if (process.env.PLAYWRIGHT_TEST !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const email = "e2e@test.local";
  const cookie = sessionCookieHeader(signSession(email));
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
