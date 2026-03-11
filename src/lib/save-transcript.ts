import fs from "node:fs/promises";
import path from "node:path";
import type { JobTimings } from "./queue";
import { ensureDirectory } from "./files";
import { safeTranscriptBasename } from "./files";

export type SavedTranscriptMeta = {
  id: string;
  originalFileName: string;
  txtPath: string;
  jsonPath: string;
  endToEndMs: number;
  bottleneck?: string;
  createdAt: string;
};

/**
 * Saves transcript and speaker text to the transcript save dir with a stats header.
 * Also writes a .json sidecar for listing (stats + meta). Returns meta for the saved files.
 */
export async function saveTranscript(
  saveDir: string,
  originalFileName: string,
  text: string,
  speakerText: string,
  timings: JobTimings
): Promise<SavedTranscriptMeta> {
  await ensureDirectory(saveDir);
  const ts = Date.now();
  const base = safeTranscriptBasename(originalFileName);
  const slug = `${ts}-${base}`;
  const txtPath = path.join(saveDir, `${slug}.txt`);
  const jsonPath = path.join(saveDir, `${slug}.json`);

  const statsBlock = [
    "--- Transcript statistics ---",
    `Processed in: ${(timings.endToEndMs / 1000).toFixed(2)}s`,
    `Upload: ${(timings.uploadMs / 1000).toFixed(2)}s | Queue wait: ${(timings.queueWaitMs / 1000).toFixed(2)}s`,
    `Chunking: ${(timings.chunkingMs / 1000).toFixed(2)}s (${timings.chunkCount} chunk(s))`,
    `Transcription API: ${(timings.perChunk.reduce((s, c) => s + c.totalMs, 0) / 1000).toFixed(2)}s`,
    `Stitching: ${(timings.stitchingMs / 1000).toFixed(2)}s`,
    timings.bottleneck ? `Bottleneck: ${timings.bottleneck.replace("_", " ")}` : "",
    "--------------------------------",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const txtContent = statsBlock + "--- Plain transcript ---\n\n" + text + "\n\n--- By speaker ---\n\n" + speakerText + "\n";
  await fs.writeFile(txtPath, txtContent, "utf-8");

  const meta: SavedTranscriptMeta = {
    id: slug,
    originalFileName,
    txtPath,
    jsonPath,
    endToEndMs: timings.endToEndMs,
    bottleneck: timings.bottleneck,
    createdAt: new Date(ts).toISOString(),
  };
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        ...meta,
        timings,
        textLength: text.length,
        speakerTextLength: speakerText.length,
      },
      null,
      2
    ),
    "utf-8"
  );

  return meta;
}
