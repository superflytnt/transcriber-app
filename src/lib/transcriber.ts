import fs from "node:fs";
import fsPromises from "node:fs/promises";
import OpenAI from "openai";
import { env } from "./env";
import { createChunks } from "./chunker";
import type {
  JobTimings,
  PerChunkTiming,
  SpeakerSegment,
  TranscriptionJobResult,
} from "./queue";

/** Node 18 lacks global File; OpenAI SDK requires it for file uploads. */
async function ensureFileGlobal(): Promise<void> {
  if (typeof globalThis.File !== "undefined") return;
  const { File } = await import("node:buffer");
  (globalThis as unknown as { File: typeof File }).File = File;
}

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!env.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }
  if (!_client) _client = new OpenAI({ apiKey: env.openAiApiKey });
  return _client;
}

type OpenAiDiarizedResponse = {
  text?: string;
  segments?: Array<{
    speaker?: string;
    start?: number;
    end?: number;
    text?: string;
  }>;
};

const segmentToLine = (segment: SpeakerSegment): string => {
  return `${segment.speaker}: ${segment.text}`;
};

/** Internal timings produced by the transcriber (worker merges in upload/queue/endToEnd) */
export type TranscribeTimings = Pick<
  JobTimings,
  "chunkingMs" | "chunkCount" | "perChunk" | "stitchingMs" | "transcriptionOnlyMs"
>;

export type TranscribeProgressCallback = (chunkIndex: number, totalChunks: number) => void;

export const transcribeWithDiarization = async (
  filePath: string,
  languageHint?: string,
  knownSpeakerNames?: string[],
  onProgress?: TranscribeProgressCallback
): Promise<TranscriptionJobResult> => {
  await ensureFileGlobal();
  const chunkingStart = Date.now();
  const chunks = await createChunks(filePath, env.uploadDir, env.chunkTargetMb);
  const chunkingMs = Date.now() - chunkingStart;
  const totalChunks = chunks.length;

  const mergedSegments: SpeakerSegment[] = [];
  const rawTextParts: string[] = [];
  const perChunk: PerChunkTiming[] = [];

  for (const chunk of chunks) {
    const chunkStart = Date.now();
    const chunkNum = chunk.chunkIndex + 1;
    console.log(`[transcribe] Starting chunk ${chunkNum} of ${totalChunks}`);
    onProgress?.(chunk.chunkIndex, totalChunks);
    let chunkSizeMb: number | undefined;
    try {
      const stat = await fsPromises.stat(chunk.filePath);
      chunkSizeMb = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
    } catch {
      // ignore
    }

    const requestPayload: Record<string, unknown> = {
      file: fs.createReadStream(chunk.filePath),
      model: "gpt-4o-transcribe-diarize",
      response_format: "diarized_json",
      chunking_strategy: "auto",
      language: languageHint,
    };

    // API expects known_speaker_names at top level (multipart: known_speaker_names[]).
    // Passing it inside extra_body would send extra_body[known_speaker_names][] which the API does not accept.
    if (knownSpeakerNames && knownSpeakerNames.length > 0) {
      requestPayload.known_speaker_names = knownSpeakerNames;
    }

    const timeoutMs = env.transcriptionChunkTimeoutMs;
    const response = (await getClient().audio.transcriptions.create(requestPayload as never, {
      timeout: timeoutMs,
    })) as OpenAiDiarizedResponse;

    const totalMs = Date.now() - chunkStart;
    perChunk.push({
      chunkIndex: chunk.chunkIndex,
      totalMs,
      chunkSizeMb,
    });

    if (response.text) {
      rawTextParts.push(response.text.trim());
    }

    for (const segment of response.segments ?? []) {
      if (!segment.text) continue;
      mergedSegments.push({
        speaker: segment.speaker ?? "Speaker",
        start: (segment.start ?? 0) + chunk.startSeconds,
        end: (segment.end ?? 0) + chunk.startSeconds,
        text: segment.text.trim(),
      });
    }

    console.log(`[transcribe] Finished chunk ${chunkNum} of ${totalChunks} (${totalMs}ms)`);
    onProgress?.(chunk.chunkIndex + 1, totalChunks);
  }

  const stitchingStart = Date.now();
  const speakerText = mergedSegments.map(segmentToLine).join("\n");
  // When speaker segments exist, include speaker names in the main transcript
  const text =
    speakerText.length > 0
      ? speakerText
      : rawTextParts.join(" ");
  const stitchingMs = Date.now() - stitchingStart;

  const transcriptionOnlyMs = chunkingMs + perChunk.reduce((s, c) => s + c.totalMs, 0) + stitchingMs;

  const transcribeTimings: TranscribeTimings = {
    chunkingMs,
    chunkCount: chunks.length,
    perChunk,
    stitchingMs,
    transcriptionOnlyMs,
  };

  return {
    text: text.trim(),
    speakerText: speakerText.trim(),
    segments: mergedSegments,
    timings: transcribeTimings as unknown as JobTimings,
  };
};
