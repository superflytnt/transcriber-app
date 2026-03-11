const maybeEnv = (name: string): string => {
  return process.env[name] ?? "";
};

/** Base dir for transcripts (per-user subdirs live under this). */
function getTranscriptSaveBaseDir(): string {
  const base = process.env.TRANSCRIPT_SAVE_DIR ?? "";
  if (base) return base;
  const upload = process.env.UPLOAD_DIR ?? "/tmp/transcriber-uploads";
  return `${upload}/transcripts`;
}

export const env = {
  redisUrl: maybeEnv("REDIS_URL"),
  openAiApiKey: maybeEnv("OPENAI_API_KEY"),
  uploadDir: process.env.UPLOAD_DIR ?? "/tmp/transcriber-uploads",
  get transcriptSaveBaseDir(): string {
    return getTranscriptSaveBaseDir();
  },
  /** Where to save completed transcripts (flat, legacy). Use userTranscriptSaveDir(userId) for per-user. */
  get transcriptSaveDir(): string {
    return getTranscriptSaveBaseDir();
  },
  chunkTargetMb: Number(process.env.CHUNK_TARGET_MB ?? "20"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? "200"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "2000"),
  sessionSecret: maybeEnv("SESSION_SECRET"),
  appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
  resendApiKey: maybeEnv("RESEND_API_KEY"),
  fromEmail: process.env.FROM_EMAIL ?? "Transcriber <onboarding@resend.dev>",
};
