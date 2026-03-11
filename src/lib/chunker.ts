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

const getAudioInfo = async (inputPath: string): Promise<AudioInfo> => {
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

export const createChunks = async (
  inputPath: string,
  workingDir: string,
  chunkTargetMb: number
): Promise<AudioChunk[]> => {
  const audioInfo = await getAudioInfo(inputPath);
  if (audioInfo.durationSeconds <= 0) {
    throw new Error("Unable to determine audio duration.");
  }

  const targetBytes = chunkTargetMb * 1024 * 1024;
  const maxChunkDurationSeconds = 1300;

  if (
    audioInfo.sizeBytes <= targetBytes &&
    audioInfo.durationSeconds <= maxChunkDurationSeconds
  ) {
    return [{ filePath: inputPath, chunkIndex: 0, startSeconds: 0 }];
  }

  // Slightly conservative segmenting to stay below provider size limits.
  const ratio = targetBytes / audioInfo.sizeBytes;
  const segmentSeconds = Math.min(
    maxChunkDurationSeconds,
    Math.max(60, Math.floor(audioInfo.durationSeconds * ratio * 0.9))
  );

  const outputDir = path.join(workingDir, `chunks-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  await splitAudio(inputPath, outputDir, segmentSeconds);

  const outputFiles = (await fs.readdir(outputDir))
    .filter((fileName) => fileName.startsWith("chunk-"))
    .sort();

  return outputFiles.map((fileName, index) => ({
    filePath: path.join(outputDir, fileName),
    chunkIndex: index,
    startSeconds: index * segmentSeconds,
  }));
};
