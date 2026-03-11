import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";

type TranscriptListItem = {
  id: string;
  originalFileName: string;
  endToEndMs: number;
  endToEndSec: number;
  bottleneck?: string;
  createdAt: string;
  downloadUrl: string;
};

export async function GET(): Promise<NextResponse> {
  try {
    await fs.mkdir(env.transcriptSaveDir, { recursive: true });
  } catch {
    // dir may already exist or be unreadable
  }

  let entries: Dirent[];
  try {
    entries = (await fs.readdir(env.transcriptSaveDir, { withFileTypes: true })) as Dirent[];
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
      const jsonPath = path.join(env.transcriptSaveDir, name);
      const raw = await fs.readFile(jsonPath, "utf-8");
      const data = JSON.parse(raw) as {
        id: string;
        originalFileName: string;
        endToEndMs: number;
        bottleneck?: string;
        createdAt: string;
      };
      list.push({
        id: data.id,
        originalFileName: data.originalFileName,
        endToEndMs: data.endToEndMs,
        endToEndSec: Math.round((data.endToEndMs / 1000) * 10) / 10,
        bottleneck: data.bottleneck,
        createdAt: data.createdAt,
        downloadUrl: `/api/transcripts/${encodeURIComponent(data.id)}`,
      });
    } catch {
      // skip invalid or unreadable json
    }
  }

  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ transcripts: list });
}
