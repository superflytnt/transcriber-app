import fs from "node:fs/promises";
import path from "node:path";
import type { TranscriptionJobResult } from "./queue";
import { env } from "./env";

export type InlineJobState = "active" | "completed" | "failed";

export type InlineJob = {
  state: InlineJobState;
  progress?: { chunk: number; total: number };
  result?: TranscriptionJobResult;
  error?: string;
};

const INLINE_JOBS_DIR = ".inline-jobs";

function jobPath(jobId: string): string {
  const base = path.join(env.uploadDir, INLINE_JOBS_DIR);
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(base, `${safe}.json`);
}

async function ensureDir(): Promise<void> {
  const dir = path.join(env.uploadDir, INLINE_JOBS_DIR);
  await fs.mkdir(dir, { recursive: true });
}

export async function setInlineJob(jobId: string, job: InlineJob): Promise<void> {
  await ensureDir();
  const p = jobPath(jobId);
  const tmp = p + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(job), "utf-8");
  await fs.rename(tmp, p);
}

export async function getInlineJob(jobId: string): Promise<InlineJob | undefined> {
  const p = jobPath(jobId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as InlineJob;
  } catch {
    return undefined;
  }
}

export async function updateInlineJobProgress(jobId: string, chunk: number, total: number): Promise<void> {
  const job = await getInlineJob(jobId);
  if (job && job.state === "active") {
    job.progress = { chunk, total };
    await setInlineJob(jobId, job);
  }
}

export async function setInlineJobState(
  jobId: string,
  update: Partial<Pick<InlineJob, "state" | "result" | "error">>
): Promise<void> {
  const job = await getInlineJob(jobId);
  if (!job) return;
  Object.assign(job, update);
  if (update.state === "completed" || update.state === "failed") job.progress = undefined;
  await setInlineJob(jobId, job);
}
