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

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const email = getCurrentUser(request);
  if (!email) {
    return NextResponse.json({ error: "Sign in to update transcripts." }, { status: 401 });
  }
  const id = params.id;
  if (!id || !isSafeId(id)) {
    return NextResponse.json({ error: "Invalid transcript id." }, { status: 400 });
  }

  let body: { speakerText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.speakerText !== "string") {
    return NextResponse.json({ error: "speakerText is required." }, { status: 400 });
  }

  const saveDir = getTranscriptSaveDirForUser(getUserId(email));
  const txtPath = path.join(saveDir, `${id}.txt`);
  const jsonPath = path.join(saveDir, `${id}.json`);

  try {
    const oldTxt = await fs.readFile(txtPath, "utf-8");

    // Rebuild the .txt: keep everything before "--- By speaker ---" and replace the rest
    const marker = "\n\n--- By speaker ---\n\n";
    const beforeMarker = oldTxt.split(marker)[0] ?? oldTxt;
    const newTxt = beforeMarker + marker + body.speakerText + "\n";
    await fs.writeFile(txtPath, newTxt, "utf-8");

    // Update .json with new speaker list
    try {
      const jsonRaw = await fs.readFile(jsonPath, "utf-8");
      const jsonData = JSON.parse(jsonRaw);
      const speakers = Array.from(
        new Set(
          body.speakerText
            .split(/\r?\n/)
            .map((line: string) => { const i = line.indexOf(": "); return i > 0 ? line.slice(0, i) : ""; })
            .filter(Boolean)
        )
      ).sort();
      jsonData.speakers = speakers;
      jsonData.speakerTextLength = body.speakerText.length;
      await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf-8");
    } catch {
      // json update is best-effort
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }
}

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
