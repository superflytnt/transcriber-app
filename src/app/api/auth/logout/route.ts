import { NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ ok: true }, {
    headers: { "Set-Cookie": clearSessionCookieHeader() },
  });
}
