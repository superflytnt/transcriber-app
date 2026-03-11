import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

ffmpeg.setFfmpegPath(ffmpegPath ?? "");
ffmpeg.setFfprobePath(ffprobePath.path);

/** Extensions OpenAI transcription API accepts (no conversion needed). */
const OPENAI_ACCEPTED_EXTENSIONS = [
  ".m4a",
  ".mp3",
  ".wav",
  ".webm",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".flac",
  ".ogg",
];

function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext;
}

/**
 * Returns a path guaranteed to be in an OpenAI-accepted format.
 * If the file is already accepted, returns the same path and empty deleteAfter.
 * Otherwise converts to .m4a in workingDir and returns the new path; caller
 * should delete the returned path after use (original is still owned by caller).
 */
export async function ensureOpenAIFormat(
  inputPath: string,
  workingDir: string
): Promise<{ path: string; deleteAfter: string[] }> {
  const ext = getExtension(inputPath);
  if (OPENAI_ACCEPTED_EXTENSIONS.includes(ext)) {
    return { path: inputPath, deleteAfter: [] };
  }

  const outputPath = path.join(
    workingDir,
    `normalized-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.m4a`
  );

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-c:a aac", "-b:a 128k"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });

  return { path: outputPath, deleteAfter: [outputPath] };
}
