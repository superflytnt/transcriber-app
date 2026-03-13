import fs from "node:fs/promises";
import { Worker } from "bullmq";
import { env } from "./lib/env";
import {
  getTranscriptionQueue,
  redisConnection,
  TranscriptionJobInput,
  transcriptionQueueName,
  TranscriptionJobResult,
} from "./lib/queue";
import { ensureDirectory } from "./lib/files";
import { runTranscriptionJob } from "./lib/run-transcription";

const start = async (): Promise<void> => {
  await ensureDirectory(env.uploadDir);
  getTranscriptionQueue();

  const worker = new Worker<TranscriptionJobInput, TranscriptionJobResult>(
    transcriptionQueueName,
    async (job) => {
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

      return runTranscriptionJob(job.data, (chunkIndex, totalChunks) => {
        void job.updateProgress({ chunk: chunkIndex + 1, total: totalChunks });
      });
    },
    {
      connection: redisConnection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? "2"),
      lockDuration: 600000,
      stalledInterval: 300000,
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
