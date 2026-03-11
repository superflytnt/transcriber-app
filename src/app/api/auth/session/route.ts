import { NextResponse } from "next/server";
import { addUser, ensureFirstAdmin, isAdmin } from "@/lib/admin-store";
import { getSessionFromRequest } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const email = getSessionFromRequest(request);
  if (!email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureFirstAdmin();
  await addUser(email);
  const admin = await isAdmin(email);
  return NextResponse.json({ email, isAdmin: admin });
}
