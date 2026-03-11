import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

type AudioInfo = {
  durationSeconds: number;
  sizeBytes: number;
};

export type AudioChunk = {
  filePath: string;
  chunkIndex: number;
  startSeconds: number;
};

function resolveFfmpeg(): string {
  const p = (ffmpegPath as string) ?? "";
  const fromCwd = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  return p && existsSync(p) ? p : fromCwd;
}
function resolveFfprobe(): string {
  const p = ffprobePath.path ?? "";
  const fromCwd = path.join(
    process.cwd(),
    "node_modules",
    "ffprobe-static",
    "bin",
    process.platform,
    process.arch,
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
  );
  return p && existsSync(p) ? p : fromCwd;
}

ffmpeg.setFfmpegPath(resolveFfmpeg());
ffmpeg.setFfprobePath(resolveFfprobe());

export const getAudioInfo = async (inputPath: string): Promise<AudioInfo> => {
  const stats = await fs.stat(inputPath);

  const durationSeconds = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }
      const duration = metadata.format.duration ?? 0;
      resolve(duration);
    });
  });

  return { durationSeconds, sizeBytes: stats.size };
};

const splitAudio = async (
  inputPath: string,
  outputDir: string,
  segmentSeconds: number
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-f segment", `-segment_time ${segmentSeconds}`, "-c copy"])
      .output(path.join(outputDir, "chunk-%03d.m4a"))
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .run();
  });
};

export type ChunkPlan = {
  durationSeconds: number;
  sizeMb: number;
  chunkCount: number;
  segmentSeconds: number;
  durationFormatted: string;
};

const MAX_CHUNK_DURATION_SECONDS = 600;
const MAX_CHUNK_SIZE_MB = 20;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m:${s.toString().padStart(2, "0")}s`;
}

function computeChunkPlan(info: AudioInfo, chunkTargetMb: number): ChunkPlan {
  const targetBytes = Math.min(chunkTargetMb, MAX_CHUNK_SIZE_MB) * 1024 * 1024;
  const sizeMb = Math.round((info.sizeBytes / (1024 * 1024)) * 10) / 10;

  if (info.sizeBytes <= targetBytes && info.durationSeconds <= MAX_CHUNK_DURATION_SECONDS) {
    return {
      durationSeconds: info.durationSeconds,
      sizeMb,
      chunkCount: 1,
      segmentSeconds: Math.ceil(info.durationSeconds),
      durationFormatted: formatDuration(info.durationSeconds),
    };
  }

  // Two constraints: each chunk must be under MAX_CHUNK_SIZE_MB and under MAX_CHUNK_DURATION_SECONDS.
  // Pick the stricter of the two.
  const bySize = info.sizeBytes > targetBytes
    ? Math.max(60, Math.floor(info.durationSeconds * (targetBytes / info.sizeBytes) * 0.9))
    : Infinity;
  const byDuration = MAX_CHUNK_DURATION_SECONDS;
  const segmentSeconds = Math.min(bySize, byDuration);
  const chunkCount = Math.ceil(info.durationSeconds / segmentSeconds);

  return {
    durationSeconds: info.durationSeconds,
    sizeMb,
    chunkCount,
    segmentSeconds,
    durationFormatted: formatDuration(info.durationSeconds),
  };
}

/**
 * Compute chunk plan without splitting — returns file metrics and planned chunk count.
 */
export const planChunks = async (
  inputPath: string,
  chunkTargetMb: number
): Promise<ChunkPlan> => {
  const audioInfo = await getAudioInfo(inputPath);
  if (audioInfo.durationSeconds <= 0) {
    throw new Error("Unable to determine audio duration.");
  }
  return computeChunkPlan(audioInfo, chunkTargetMb);
};

export const createChunks = async (
  inputPath: string,
  workingDir: string,
  chunkTargetMb: number
): Promise<AudioChunk[]> => {
  const audioInfo = await getAudioInfo(inputPath);
  if (audioInfo.durationSeconds <= 0) {
    throw new Error("Unable to determine audio duration.");
  }

  const plan = computeChunkPlan(audioInfo, chunkTargetMb);

  if (plan.chunkCount === 1) {
    return [{ filePath: inputPath, chunkIndex: 0, startSeconds: 0 }];
  }

  const outputDir = path.join(workingDir, `chunks-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  await splitAudio(inputPath, outputDir, plan.segmentSeconds);

  const outputFiles = (await fs.readdir(outputDir))
    .filter((fileName) => fileName.startsWith("chunk-"))
    .sort();

  return outputFiles.map((fileName, index) => ({
    filePath: path.join(outputDir, fileName),
    chunkIndex: index,
    startSeconds: index * plan.segmentSeconds,
  }));
};
