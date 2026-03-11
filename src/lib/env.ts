const maybeEnv = (name: string): string => {
  return process.env[name] ?? "";
};

export const env = {
  redisUrl: maybeEnv("REDIS_URL"),
  openAiApiKey: maybeEnv("OPENAI_API_KEY"),
  uploadDir: process.env.UPLOAD_DIR ?? "/tmp/transcriber-uploads",
  /** Where to save completed transcripts. Always under uploadDir so worker and API share the same path. */
  get transcriptSaveDir(): string {
    const base = process.env.TRANSCRIPT_SAVE_DIR ?? "";
    if (base) return base;
    const upload = process.env.UPLOAD_DIR ?? "/tmp/transcriber-uploads";
    return `${upload}/transcripts`;
  },
  chunkTargetMb: Number(process.env.CHUNK_TARGET_MB ?? "20"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? "200"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "2000"),
};
