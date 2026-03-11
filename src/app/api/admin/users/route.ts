import { NextRequest, NextResponse } from "next/server";
import { isAdmin, listUsers } from "@/lib/admin-store";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin(request: Request): Promise<{ email: string } | NextResponse> {
  const email = getCurrentUser(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await isAdmin(email))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return { email };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 25));
  const search = (searchParams.get("search") ?? "").trim();
  const offset = (page - 1) * limit;
  const { users, total } = await listUsers({ offset, limit, search: search || undefined });
  return NextResponse.json({ users, total, page, limit });
}
