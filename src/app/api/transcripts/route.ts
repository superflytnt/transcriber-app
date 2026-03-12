import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserId, getTranscriptSaveDirForUser } from "@/lib/user-id";
import { deleteLegacyTranscriptsOnce } from "@/lib/transcripts-cleanup";

export const runtime = "nodejs";

type TranscriptListItem = {
  id: string;
  originalFileName: string;
  endToEndMs: number;
  endToEndSec: number;
  bottleneck?: string;
  createdAt: string;
  downloadUrl: string;
  speakers?: string[];
  timings?: Record<string, unknown>;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const email = getCurrentUser(request);
  if (!email) {
    return NextResponse.json({ error: "Sign in to see your transcripts." }, { status: 401 });
  }
  await deleteLegacyTranscriptsOnce();
  const saveDir = getTranscriptSaveDirForUser(getUserId(email));
  try {
    await fs.mkdir(saveDir, { recursive: true });
  } catch {
    // dir may already exist or be unreadable
  }

  let entries: Dirent[];
  try {
    entries = (await fs.readdir(saveDir, { withFileTypes: true })) as Dirent[];
  } catch {
    return NextResponse.json(
      { error: "Saved transcripts are temporarily unavailable. Please try again later." },
      { status: 500 }
    );
  }

  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name);

  const list: TranscriptListItem[] = [];

  for (const name of jsonFiles) {
    try {
      const jsonPath = path.join(saveDir, name);
      const raw = await fs.readFile(jsonPath, "utf-8");
      const data = JSON.parse(raw) as {
        id: string;
        originalFileName: string;
        endToEndMs: number;
        bottleneck?: string;
        createdAt: string;
        speakers?: string[];
        timings?: Record<string, unknown>;
      };

      let speakers = data.speakers;
      if (!speakers || speakers.length === 0) {
        const txtPath = path.join(saveDir, name.replace(/\.json$/, ".txt"));
        try {
          const txt = await fs.readFile(txtPath, "utf-8");
          const bySpeaker = txt.split("\n\n--- By speaker ---\n\n")[1] ?? "";
          speakers = Array.from(
            new Set(
              bySpeaker
                .split(/\r?\n/)
                .map((line) => { const i = line.indexOf(": "); return i > 0 ? line.slice(0, i) : ""; })
                .filter(Boolean)
            )
          ).sort();
        } catch {
          speakers = [];
        }
      }

      list.push({
        id: data.id,
        originalFileName: data.originalFileName,
        endToEndMs: data.endToEndMs,
        endToEndSec: Math.round((data.endToEndMs / 1000) * 10) / 10,
        bottleneck: data.bottleneck,
        createdAt: data.createdAt,
        downloadUrl: `/api/transcripts/${encodeURIComponent(data.id)}`,
        speakers,
        timings: data.timings,
      });
    } catch {
      // skip invalid or unreadable json
    }
  }

  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ transcripts: list });
}
