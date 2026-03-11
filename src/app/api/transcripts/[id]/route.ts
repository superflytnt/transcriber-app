import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserId, getTranscriptSaveDirForUser } from "@/lib/user-id";

export const runtime = "nodejs";

/** Allow only safe slug: numbers, letters, underscore, hyphen. */
function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 120;
}

type Params = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const email = getCurrentUser(request);
  if (!email) {
    return NextResponse.json({ error: "Sign in to download transcripts." }, { status: 401 });
  }
  const id = params.id;
  if (!id || !isSafeId(id)) {
    return NextResponse.json({ error: "Invalid transcript id." }, { status: 400 });
  }

  const saveDir = getTranscriptSaveDirForUser(getUserId(email));
  const txtPath = path.join(saveDir, `${id}.txt`);
  try {
    const content = await fs.readFile(txtPath, "utf-8");
    const baseName = id.endsWith(".txt") ? id : `${id}.txt`;
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }
}
