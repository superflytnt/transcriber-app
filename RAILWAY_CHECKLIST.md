# Railway: “Drop a file and it works” checklist

Double-checked so tomorrow you can open the site, drop a file, and have it work.

## Required on Railway

1. **Environment variables**
   - `REDIS_URL` – Redis connection string (required; queue + worker use it).
   - `OPENAI_API_KEY` – Required for transcription.
   - Optional: `UPLOAD_DIR` (default `/tmp/transcriber-uploads`), `CHUNK_TARGET_MB` (20), `MAX_UPLOAD_MB` (200).

2. **Single replica (recommended)**
   - So the same container that receives the upload also runs the worker and serves “Saved transcripts.”
   - With multiple replicas, uploads and workers can be on different containers, so jobs can fail with “Uploaded file not found” and the saved list can stay empty.

3. **Start command**
   - Use `node scripts/start.mjs` (or `npm run start`) so both web and worker run in the same process tree and share the same filesystem.

## What happens when you drop a file

1. **Frontend** – Accepts if extension is in the allowed list **or** if `file.type` is `audio/*` and the file has a name. Rejects empty files and invalid types with a clear error.
2. **POST /api/jobs** – Rejects 0-byte files and nameless files. Validates extension or audio MIME. Writes file to `uploadDir`, enqueues job with `filePath`, `originalFileName`, etc., returns `jobId`.
3. **Frontend** – Polls `GET /api/jobs/{id}` every 1.5s. Handles non-OK responses and JSON errors; sets a clear error and stops polling on failure.
4. **Worker** – Checks that the uploaded file exists (clear error if missing, e.g. multi-replica). Converts to an OpenAI-accepted format if needed, transcribes, saves transcript + stats to `uploadDir/transcripts`, returns result.
5. **Frontend** – On `state: "completed"` shows transcript and timings; on `state: "failed"` shows the server error message in a visible error box.

## Bugs fixed in this pass

- **Polling:** Non-OK responses (404, 500) and JSON parse failures now set an error and stop polling instead of hanging.
- **Upload:** JSON parse failure after POST now shows “Invalid response from server” and always clears “Uploading…”.
- **Upload:** Missing `jobId` in response now shows an error instead of polling with undefined.
- **API:** Empty files (0 bytes) and files with no name are rejected with clear messages.
- **API:** Audio-type fallback only used when the file has a non-empty (trimmed) name.
- **Worker:** If the uploaded file is missing (e.g. different replica), the job fails with a clear message suggesting 1 replica.

## Quick test

1. Open `https://transcriber2-production.up.railway.app` (or your Railway URL).
2. Drop an `.m4a` or `.mp3` (or use “Choose file”).
3. You should see: “Uploading…” → “Waiting in queue…” or “Transcribing…” → “Done” and the transcript.
4. If something fails, the red error box should explain what went wrong.

## Verifying large files (e.g. 42MB) in logs

Transcription runs in the background. For large files the worker may take several minutes (chunking + many API calls). To confirm the file is being processed:

1. In **Railway → your service → Deployments → View logs**, watch for a line like:
   ```json
   {"event":"job_started","jobId":"...","fileName":"yourfile.m4a","fileSizeMb":42,"message":"Processing transcription (chunking and API calls may take several minutes for large files)."}
   ```
2. That means the worker picked up the job and is processing that file. Progress is reported per chunk; when it finishes you’ll see a `Completed job ...` or a JSON line with `endToEndMs`, `bottleneck`, etc.
3. The UI shows **“Transcribing… (chunk X of Y)”** so you can see progress without checking logs.

## If it still doesn’t work

- Check Railway logs for the web and worker (REDIS_URL, OPENAI_API_KEY, and any stack traces).
- Ensure the service uses **one replica** so upload and worker share the same disk.
- Confirm start command is `node scripts/start.mjs` so both web and worker run.
