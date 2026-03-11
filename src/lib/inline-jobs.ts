import type { TranscriptionJobResult } from "./queue";

export type InlineJobState = "active" | "completed" | "failed";

export type InlineJob = {
  state: InlineJobState;
  progress?: { chunk: number; total: number };
  result?: TranscriptionJobResult;
  error?: string;
};

const store = new Map<string, InlineJob>();

export function setInlineJob(jobId: string, job: InlineJob): void {
  store.set(jobId, job);
}

export function getInlineJob(jobId: string): InlineJob | undefined {
  return store.get(jobId);
}

export function updateInlineJobProgress(jobId: string, chunk: number, total: number): void {
  const job = store.get(jobId);
  if (job && job.state === "active") {
    job.progress = { chunk, total };
  }
}
