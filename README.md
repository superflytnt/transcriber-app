# Transcriber App

Drag-and-drop transcription app with speaker identification, built for Railway.

## What It Does

- Upload iPhone/Mac audio files from the browser
- Queue background transcription jobs (BullMQ + Redis)
- Split long files into 20MB-target chunks automatically
- Transcribe with `gpt-4o-transcribe-diarize`
- Return plain transcript and speaker-labeled transcript
- One-click copy for either output

## Environment Variables

Copy `.env.example` to `.env.local` for local work:

```bash
cp .env.example .env.local
```

Required values:

- `OPENAI_API_KEY`
- `REDIS_URL`

Useful defaults:

- `CHUNK_TARGET_MB=20`
- `MAX_UPLOAD_MB=200`

## Local Run

In one terminal:

```bash
npm run dev
```

In another terminal:

```bash
npm run worker
```

Then open `http://localhost:3000`.

## Railway Deployment

Create two services from this same repo:

1. `web` service
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`

2. `worker` service
   - Build command: `npm install`
   - Start command: `npm run worker`

Add a Railway Redis service and set shared env vars on both services:

- `OPENAI_API_KEY`
- `REDIS_URL` (from Railway Redis)
- `CHUNK_TARGET_MB=20`
- `MAX_UPLOAD_MB=200`
- `UPLOAD_DIR=/tmp/transcriber-uploads`

Notes:

- This version stores uploads on local service disk during job execution.
- For high-scale or multi-instance reliability, move uploads to object storage and keep only metadata in the queue.
