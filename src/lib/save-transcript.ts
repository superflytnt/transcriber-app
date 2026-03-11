import fs from "node:fs/promises";
import path from "node:path";
import type { JobTimings } from "./queue";
import { ensureDirectory } from "./files";
import { safeTranscriptBasename } from "./files";
import { formatDurationMs } from "./format-duration";

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

  const apiMs = timings.perChunk.reduce((s, c) => s + c.totalMs, 0);
  const statsBlock = [
    "--- Transcript statistics ---",
    `Processed in: ${formatDurationMs(timings.endToEndMs)}`,
    `Upload: ${formatDurationMs(timings.uploadMs)} | Queue wait: ${formatDurationMs(timings.queueWaitMs)}`,
    `Chunking: ${formatDurationMs(timings.chunkingMs)} (${timings.chunkCount} chunk(s))`,
    `Transcription API: ${formatDurationMs(apiMs)}`,
    `Stitching: ${formatDurationMs(timings.stitchingMs)}`,
    timings.bottleneck ? `Bottleneck: ${timings.bottleneck.replace("_", " ")}` : "",
    "--------------------------------",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const txtContent = statsBlock + "--- Plain transcript ---\n\n" + text + "\n\n--- By speaker ---\n\n" + speakerText + "\n";
  await fs.writeFile(txtPath, txtContent, "utf-8");

  const speakers = Array.from(
    new Set(
      speakerText
        .split(/\r?\n/)
        .map((line) => { const i = line.indexOf(": "); return i > 0 ? line.slice(0, i) : ""; })
        .filter(Boolean)
    )
  ).sort();

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
        speakers,
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
