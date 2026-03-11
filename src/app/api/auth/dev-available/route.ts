import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Returns whether dev sign-in (no email) is available. Only true in development. */
export async function GET(): Promise<NextResponse> {
  const available = process.env.NODE_ENV === "development";
  return NextResponse.json({ available });
}
