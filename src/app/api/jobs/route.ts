import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { env } from "@/lib/env";
import { bytesToMb, ensureDirectory, safeUploadPath } from "@/lib/files";
import { getTranscriptionQueue } from "@/lib/queue";

export const runtime = "nodejs";

/** Allow long-running uploads (e.g. 30MB+ / hour-long files) so the request is not killed. */
export const maxDuration = 300;

const ALLOWED_EXTENSIONS = [
  ".m4a",
  ".mp3",
  ".wav",
  ".aac",
  ".webm",
  ".qta",
  ".flac",
  ".ogg",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".mov",
];

function getExtension(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext ? `.${ext}` : "";
}

function isAllowedFile(name: string): boolean {
  return ALLOWED_EXTENSIONS.includes(getExtension(name));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const uploadStartedAt = Date.now();
    await ensureDirectory(env.uploadDir);

    const formData = await request.formData();
    const fileValue = formData.get("file");
    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    if (fileValue.size === 0) {
      return NextResponse.json(
        { error: "File is empty. Please choose an audio file with content." },
        { status: 400 }
      );
    }

    const name = (fileValue.name || "").trim();
    if (!name) {
      return NextResponse.json(
        { error: "File has no name. Please choose a named audio file." },
        { status: 400 }
      );
    }

    const ext = getExtension(fileValue.name);
    const hasAudioType = (fileValue.type || "").toLowerCase().startsWith("audio/");
    if (!isAllowedFile(fileValue.name) && !(hasAudioType && name)) {
      return NextResponse.json(
        {
          error: `Unsupported file format ${ext.slice(1) || "unknown"}. Use one of: ${ALLOWED_EXTENSIONS.join(", ").replace(/\./g, "")}. Or use an audio file with a clear extension (e.g. .m4a, .mp3).`,
        },
        { status: 400 }
      );
    }

    const fileMb = bytesToMb(fileValue.size);
    if (fileMb > env.maxUploadMb) {
      return NextResponse.json(
        {
          error: `File is ${fileMb.toFixed(
            1
          )}MB. Max size is ${env.maxUploadMb}MB for this app.`,
        },
        { status: 413 }
      );
    }

    const uploadPath = safeUploadPath(env.uploadDir, fileValue.name);
    const writeStream = fs.createWriteStream(uploadPath);
    await pipeline(Readable.fromWeb(fileValue.stream() as never), writeStream);
    const uploadFinishedAt = Date.now();

    const languageHint = String(formData.get("languageHint") ?? "").trim() || undefined;
    const knownSpeakerNamesRaw = String(formData.get("knownSpeakerNames") ?? "").trim();
    const knownSpeakerNames =
      knownSpeakerNamesRaw.length > 0
        ? knownSpeakerNamesRaw
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
        : undefined;

    const queue = getTranscriptionQueue();
    const job = await queue.add(
      "transcribe",
      {
        filePath: uploadPath,
        originalFileName: fileValue.name,
        mimeType: fileValue.type,
        languageHint,
        knownSpeakerNames,
        uploadStartedAt,
        uploadFinishedAt,
      },
      {
        jobId: uuidv4(),
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      }
    );

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
