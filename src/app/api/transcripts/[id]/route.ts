import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/** Allow only safe slug: numbers, letters, underscore, hyphen. */
function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 120;
}

type Params = { params: { id: string } };

export async function GET(_: Request, { params }: Params): Promise<NextResponse> {
  const id = params.id;
  if (!id || !isSafeId(id)) {
    return NextResponse.json({ error: "Invalid transcript id." }, { status: 400 });
  }

  const txtPath = path.join(env.transcriptSaveDir, `${id}.txt`);
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
