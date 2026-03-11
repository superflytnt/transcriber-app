import { NextRequest, NextResponse } from "next/server";
import { isAdmin, setAdmin } from "@/lib/admin-store";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const email = getCurrentUser(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await isAdmin(email))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const targetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const isAdminFlag = body.isAdmin === true;
  if (!targetEmail) return NextResponse.json({ error: "email is required." }, { status: 400 });
  await setAdmin(targetEmail, isAdminFlag);
  return NextResponse.json({ ok: true, email: targetEmail, isAdmin: isAdminFlag });
}
