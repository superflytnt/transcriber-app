import { NextResponse } from "next/server";
import { Job } from "bullmq";
import {
  getTranscriptionQueue,
  TranscriptionJobResult,
  transcriptionQueueName,
} from "@/lib/queue";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function GET(_: Request, { params }: Params): Promise<NextResponse> {
  const queue = getTranscriptionQueue();
  const job = await Job.fromId<unknown, TranscriptionJobResult>(
    queue,
    params.id
  );

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
    const userMessage =
      /REDIS|ENOENT|not found|required\.|ECONNREFUSED|timeout/i.test(raw)
        ? "Transcription failed. Please try again with another file."
        : raw && raw.length < 120
          ? raw
          : "Transcription failed. Please try again with another file.";
    return NextResponse.json(
      { state, progress, error: userMessage },
      { status: 500 }
    );
  }

  return NextResponse.json({
    state,
    progress,
    queue: transcriptionQueueName,
  });
}
