import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const email = getSessionFromRequest(request);
  if (!email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ email });
}
