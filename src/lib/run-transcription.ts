import fs from "node:fs/promises";
import { env } from "./env";
import { ensureOpenAIFormat } from "./audio-normalize";
import {
  getBottleneck,
  type JobTimings,
  type TranscriptionJobInput,
  type TranscriptionJobResult,
} from "./queue";
import { saveTranscript } from "./save-transcript";
import { transcribeWithDiarization } from "./transcriber";

export type RunTranscriptionProgress = (chunkIndex: number, totalChunks: number) => void;

/**
 * Run a single transcription job (shared by worker and inline API when Redis is not used).
 * Verifies file exists, normalizes format, transcribes, deletes temp files, optionally saves to transcript folder.
 */
export async function runTranscriptionJob(
  data: TranscriptionJobInput,
  onProgress?: RunTranscriptionProgress
): Promise<TranscriptionJobResult> {
  const workerStartedAt = Date.now();
  const uploadStartedAt = data.uploadStartedAt ?? workerStartedAt;
  const uploadFinishedAt = data.uploadFinishedAt ?? workerStartedAt;
  const jobAddedAtMs = data.uploadFinishedAt ?? workerStartedAt;
  const queueWaitMs = Math.max(0, workerStartedAt - jobAddedAtMs);

  try {
    await fs.access(data.filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error("The uploaded file could not be found. Please try uploading again.");
    }
    throw err;
  }

  const { path: pathToUse, deleteAfter } = await ensureOpenAIFormat(
    data.filePath,
    env.uploadDir
  );

  const result = await transcribeWithDiarization(
    pathToUse,
    data.languageHint,
    data.knownSpeakerNames,
    onProgress
  );

  await fs.unlink(data.filePath).catch(() => undefined);
  for (const p of deleteAfter) {
    await fs.unlink(p).catch(() => undefined);
  }

  const jobFinishedAt = Date.now();
  const uploadMs = uploadFinishedAt - uploadStartedAt;
  const endToEndMs = jobFinishedAt - uploadStartedAt;

  if (!result.timings) {
    return result;
  }

  const fullTimings: JobTimings = {
    uploadMs,
    queueWaitMs,
    chunkingMs: result.timings.chunkingMs,
    chunkCount: result.timings.chunkCount,
    perChunk: result.timings.perChunk,
    stitchingMs: result.timings.stitchingMs,
    transcriptionOnlyMs: result.timings.transcriptionOnlyMs,
    endToEndMs,
    bottleneck: getBottleneck({
      ...result.timings,
      uploadMs,
      queueWaitMs,
      endToEndMs,
    } as JobTimings),
  };

  const withTimings = { ...result, timings: fullTimings };

  const saveDir = data.userId
    ? (await import("./user-id")).getTranscriptSaveDirForUser(data.userId)
    : env.transcriptSaveDir;
  try {
    await saveTranscript(
      saveDir,
      data.originalFileName ?? "audio",
      result.text,
      result.speakerText,
      fullTimings
    );
  } catch {
    // non-fatal: transcript still returned to user
  }

  return withTimings;
}
