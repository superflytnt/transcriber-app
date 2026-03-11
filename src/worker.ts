import fs from "node:fs/promises";
import { Worker } from "bullmq";
import { env } from "./lib/env";
import {
  getBottleneck,
  getTranscriptionQueue,
  type JobTimings,
  redisConnection,
  TranscriptionJobInput,
  transcriptionQueueName,
  TranscriptionJobResult,
} from "./lib/queue";
import { ensureDirectory } from "./lib/files";
import { ensureOpenAIFormat } from "./lib/audio-normalize";
import { saveTranscript } from "./lib/save-transcript";
import { transcribeWithDiarization } from "./lib/transcriber";

const start = async (): Promise<void> => {
  await ensureDirectory(env.uploadDir);
  getTranscriptionQueue();

  const worker = new Worker<TranscriptionJobInput, TranscriptionJobResult>(
    transcriptionQueueName,
    async (job) => {
      const workerStartedAt = Date.now();
      const uploadStartedAt = job.data.uploadStartedAt ?? workerStartedAt;
      const uploadFinishedAt = job.data.uploadFinishedAt ?? workerStartedAt;

      try {
        await fs.access(job.data.filePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          console.warn("Uploaded file not found (ENOENT). If the app runs on multiple servers, use 1 replica so upload and worker share the same disk.");
          throw new Error("The uploaded file could not be found. Please try uploading again.");
        }
        throw err;
      }

      let fileSizeMb: number | undefined;
      try {
        const stat = await fs.stat(job.data.filePath);
        fileSizeMb = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
      } catch {
        // ignore
      }
      console.log(
        JSON.stringify({
          event: "job_started",
          jobId: job.id,
          fileName: job.data.originalFileName,
          fileSizeMb,
          message: "Processing transcription (chunking and API calls may take several minutes for large files).",
        })
      );

      const { path: pathToUse, deleteAfter } = await ensureOpenAIFormat(
        job.data.filePath,
        env.uploadDir
      );

      const result = await transcribeWithDiarization(
        pathToUse,
        job.data.languageHint,
        job.data.knownSpeakerNames,
        (chunkIndex, totalChunks) => {
          void job.updateProgress({ chunk: chunkIndex + 1, total: totalChunks });
        }
      );

      await fs.unlink(job.data.filePath).catch(() => undefined);
      for (const p of deleteAfter) {
        await fs.unlink(p).catch(() => undefined);
      }

      const jobFinishedAt = Date.now();
      const uploadMs = uploadFinishedAt - uploadStartedAt;
      // BullMQ timestamp is already milliseconds (when job was queued)
      const jobAddedAtMs =
        typeof job.timestamp === "number" ? job.timestamp : Date.now();
      const queueWaitMs = Math.max(0, workerStartedAt - jobAddedAtMs);
      const endToEndMs = jobFinishedAt - uploadStartedAt;

      if (result.timings) {
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
        try {
          const meta = await saveTranscript(
            env.transcriptSaveDir,
            job.data.originalFileName ?? "audio",
            result.text,
            result.speakerText,
            fullTimings
          );
          console.log(JSON.stringify({ saved: meta.id, endToEndMs: meta.endToEndMs }));
        } catch (err) {
          console.error("Failed to save transcript to folder:", (err as Error).message);
        }
        return withTimings;
      }

      return result;
    },
    {
      connection: redisConnection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? "2"),
    }
  );

  worker.on("completed", (job) => {
    const result = job.returnvalue as TranscriptionJobResult | undefined;
    const t = result?.timings;
    if (t) {
      const topChunks = [...t.perChunk].sort((a, b) => b.totalMs - a.totalMs).slice(0, 3);
      console.log(
        JSON.stringify({
          jobId: job.id,
          endToEndMs: t.endToEndMs,
          bottleneck: t.bottleneck,
          uploadMs: t.uploadMs,
          queueWaitMs: t.queueWaitMs,
          chunkingMs: t.chunkingMs,
          stitchingMs: t.stitchingMs,
          topChunks: topChunks.map((c) => ({ i: c.chunkIndex, ms: c.totalMs })),
        })
      );
    } else {
      console.log(`Completed job ${job.id}`);
    }
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed job ${job?.id}:`, error.message);
  });
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
