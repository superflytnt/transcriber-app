import { NextResponse } from "next/server";
import { Job } from "bullmq";
import { getInlineJob } from "@/lib/inline-jobs";
import {
  getTranscriptionQueue,
  TranscriptionJobResult,
  transcriptionQueueName,
} from "@/lib/queue";

export const runtime = "nodejs";

type Params = { params: { id: string } };

function toUserMessage(raw: string): string {
  return /REDIS|ENOENT|not found|required\.|ECONNREFUSED|timeout/i.test(raw)
    ? "Transcription failed. Please try again with another file."
    : raw && raw.length < 120
      ? raw
      : "Transcription failed. Please try again with another file.";
}

export async function GET(_: Request, { params }: Params): Promise<NextResponse> {
  const id = params.id ?? "";

  if (id.startsWith("inline-")) {
    const job = getInlineJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (job.state === "completed" && job.result) {
      return NextResponse.json({ state: job.state, progress: job.progress, result: job.result });
    }
    if (job.state === "failed") {
      return NextResponse.json(
        { state: job.state, progress: job.progress, error: toUserMessage(job.error ?? "") },
        { status: 500 }
      );
    }
    return NextResponse.json({ state: job.state, progress: job.progress });
  }

  const queue = getTranscriptionQueue();
  const job = await Job.fromId<unknown, TranscriptionJobResult>(queue, id);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const state = await job.getState();
  const progress = job.progress;

  if (state === "completed") {
    const returnValue = job.returnvalue as TranscriptionJobResult;
    return NextResponse.json({
      state,
      progress,
      result: returnValue,
      queue: transcriptionQueueName,
    });
  }

  if (state === "failed") {
    const raw = job.failedReason ?? "";
    return NextResponse.json(
      { state, progress, error: toUserMessage(raw) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    state,
    progress,
    queue: transcriptionQueueName,
  });
}
