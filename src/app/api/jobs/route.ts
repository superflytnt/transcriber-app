import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { getUserId, getTranscriptSaveDirForUser } from "@/lib/user-id";
import { bytesToMb, ensureDirectory, safeUploadPath } from "@/lib/files";
import { setInlineJob, setInlineJobState, updateInlineJobProgress } from "@/lib/inline-jobs";
import { getTranscriptionQueue } from "@/lib/queue";
import { runTranscriptionJob } from "@/lib/run-transcription";
import { planChunks } from "@/lib/chunker";

export const runtime = "nodejs";

/** Allow long-running uploads (e.g. 30MB+ / hour-long files) so the request is not killed. */
export const maxDuration = 300;

const ALLOWED_EXTENSIONS = [
  ".m4a",
  ".m4v",
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

/** File-like (works in Node 18 where global File may be undefined). */
function isFileLike(
  v: unknown
): v is { name: string; size: number; type: string; stream: () => ReadableStream } {
  return (
    v != null &&
    typeof v === "object" &&
    "name" in v &&
    typeof (v as { name: unknown }).name === "string" &&
    "size" in v &&
    typeof (v as { size: unknown }).size === "number" &&
    "stream" in v &&
    typeof (v as { stream: unknown }).stream === "function"
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const email = getCurrentUser(request);
  if (!email) {
    return NextResponse.json({ error: "Sign in to upload and save transcripts." }, { status: 401 });
  }
  const userId = getUserId(email);
  let uploadPath: string | null = null;
  try {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request was cancelled." }, { status: 499 });
    }
    const uploadStartedAt = Date.now();
    await ensureDirectory(env.uploadDir);
    await ensureDirectory(getTranscriptSaveDirForUser(userId));

    const formDataStart = Date.now();
    const formData = await request.formData();
    const formDataMs = Date.now() - formDataStart;
    console.log("[POST /api/jobs] formData received", { formDataMs, formDataMb: "(see file size below)" });
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request was cancelled." }, { status: 499 });
    }
    const fileValue = formData.get("file");
    if (!isFileLike(fileValue)) {
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

    uploadPath = safeUploadPath(env.uploadDir, fileValue.name);
    const writeStart = Date.now();
    const writeStream = fs.createWriteStream(uploadPath);
    await pipeline(Readable.fromWeb(fileValue.stream() as never), writeStream, {
      signal: request.signal,
    });
    const writeMs = Date.now() - writeStart;
    console.log("[POST /api/jobs] file written to disk", { writeMs, fileMb: bytesToMb(fileValue.size) });
    if (request.signal.aborted) {
      await fsPromises.unlink(uploadPath).catch(() => undefined);
      return NextResponse.json({ error: "Request was cancelled." }, { status: 499 });
    }
    const uploadFinishedAt = Date.now();

    let fileInfo: { durationSeconds: number; sizeMb: number; chunkCount: number; durationFormatted: string } | undefined;
    try {
      const plan = await planChunks(uploadPath, env.chunkTargetMb);
      fileInfo = {
        durationSeconds: plan.durationSeconds,
        sizeMb: plan.sizeMb,
        chunkCount: plan.chunkCount,
        durationFormatted: plan.durationFormatted,
      };
      console.log("[POST /api/jobs] file probed", fileInfo);
    } catch (probeErr) {
      console.warn("[POST /api/jobs] ffprobe failed, continuing without file info", probeErr);
    }

    const languageHint = String(formData.get("languageHint") ?? "").trim() || undefined;
    const knownSpeakerNamesRaw = String(formData.get("knownSpeakerNames") ?? "").trim();
    const knownSpeakerNames =
      knownSpeakerNamesRaw.length > 0
        ? knownSpeakerNamesRaw
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
        : undefined;

    const jobData = {
      filePath: uploadPath,
      originalFileName: fileValue.name,
      mimeType: fileValue.type,
      languageHint,
      knownSpeakerNames,
      uploadStartedAt,
      uploadFinishedAt,
      userId,
    };

    if (env.redisUrl) {
      const queueStart = Date.now();
      const queue = getTranscriptionQueue();
      const job = await queue.add("transcribe", jobData, {
        jobId: uuidv4(),
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      });
      console.log("[POST /api/jobs] job queued (Redis)", { queueMs: Date.now() - queueStart, jobId: job.id });
      return NextResponse.json({ jobId: job.id, fileInfo });
    }

    if (request.signal.aborted) {
      await fsPromises.unlink(uploadPath).catch(() => undefined);
      return NextResponse.json({ error: "Request was cancelled." }, { status: 499 });
    }
    const jobId = `inline-${uuidv4()}`;
    await setInlineJob(jobId, { state: "active" });
    console.log("[POST /api/jobs] no Redis — returning jobId immediately, running transcription in background", { jobId, fileInfo });
    void runTranscriptionJob(jobData, (chunkIndex, totalChunks) => {
      void updateInlineJobProgress(jobId, chunkIndex + 1, totalChunks);
    })
      .then(async (result) => {
        await setInlineJobState(jobId, {
          state: "completed",
          result: { text: result.text, speakerText: result.speakerText, segments: result.segments, timings: result.timings },
        });
        console.log("[POST /api/jobs] inline transcription finished", { jobId });
      })
      .catch(async (err) => {
        await setInlineJobState(jobId, {
          state: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
        console.error("[POST /api/jobs] inline transcription failed", jobId, err);
      });
    return NextResponse.json({ jobId, fileInfo });
  } catch (err) {
    if (uploadPath) {
      await fsPromises.unlink(uploadPath).catch(() => undefined);
    }
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) {
      return NextResponse.json({ error: "Request was cancelled." }, { status: 499 });
    }
    console.error("[POST /api/jobs]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    return NextResponse.json(
      { error: "Something went wrong. Please try again in a moment." },
      { status: 500 }
    );
  }
}
