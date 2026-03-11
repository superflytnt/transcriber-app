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
    return NextResponse.json(
      {
        state,
        progress,
        error: job.failedReason ?? "Transcription failed.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    state,
    progress,
    queue: transcriptionQueueName,
  });
}
