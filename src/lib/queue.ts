import { Queue } from "bullmq";
import { env } from "./env";

export const transcriptionQueueName = "transcription-jobs";

export const redisConnection = {
  url: env.redisUrl,
};

/** Per-chunk timing from API request start to response parsed */
export type PerChunkTiming = {
  chunkIndex: number;
  totalMs: number;
  chunkDurationSec?: number;
  chunkSizeMb?: number;
};

/** Stage-level timings for a full transcription job */
export type JobTimings = {
  uploadMs: number;
  queueWaitMs: number;
  chunkingMs: number;
  chunkCount: number;
  perChunk: PerChunkTiming[];
  stitchingMs: number;
  transcriptionOnlyMs: number;
  endToEndMs: number;
  /** Heuristic: which stage dominates (for optimization targeting) */
  bottleneck?: "upload_bound" | "queue_bound" | "chunking_bound" | "api_bound" | "stitching_bound";
};

export type TranscriptionJobInput = {
  filePath: string;
  originalFileName: string;
  mimeType: string;
  languageHint?: string;
  knownSpeakerNames?: string[];
  /** Epoch ms when upload request started (for uploadMs) */
  uploadStartedAt?: number;
  /** Epoch ms when upload finished and file was persisted (for uploadMs) */
  uploadFinishedAt?: number;
};

export type SpeakerSegment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type TranscriptionJobResult = {
  text: string;
  speakerText: string;
  segments: SpeakerSegment[];
  timings?: JobTimings;
};

/** Compute which stage is the bottleneck from timings (largest non-zero component) */
export function getBottleneck(t: JobTimings): JobTimings["bottleneck"] {
  const candidates: { stage: JobTimings["bottleneck"]; ms: number }[] = [
    { stage: "upload_bound", ms: t.uploadMs },
    { stage: "queue_bound", ms: t.queueWaitMs },
    { stage: "chunking_bound", ms: t.chunkingMs },
    { stage: "api_bound", ms: t.perChunk.reduce((sum, c) => sum + c.totalMs, 0) },
    { stage: "stitching_bound", ms: t.stitchingMs },
  ];
  const top = candidates.filter((c) => c.ms > 0).sort((a, b) => b.ms - a.ms)[0];
  return top?.stage;
}

let queueInstance:
  | Queue<TranscriptionJobInput, TranscriptionJobResult, "transcribe">
  | null = null;

export const getTranscriptionQueue = (): Queue<
  TranscriptionJobInput,
  TranscriptionJobResult,
  "transcribe"
> => {
  if (!env.redisUrl) {
    throw new Error("REDIS_URL is required.");
  }

  if (!queueInstance) {
    queueInstance = new Queue<TranscriptionJobInput, TranscriptionJobResult, "transcribe">(
      transcriptionQueueName,
      { connection: redisConnection }
    );
  }

  return queueInstance;
};
