import { NextRequest, NextResponse } from "next/server";
import { verifyCode } from "@/lib/auth-store";
import { signSession, sessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    const email = await verifyCode(code);
    if (!email) {
      return NextResponse.json(
        { error: "This code is invalid or has expired. Request a new sign-in email." },
        { status: 400 }
      );
    }
    const cookie = sessionCookieHeader(signSession(email));
    return NextResponse.json({ ok: true, email }, {
      headers: { "Set-Cookie": cookie },
    });
  } catch (err) {
    console.error("[POST /api/auth/verify-code]", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
