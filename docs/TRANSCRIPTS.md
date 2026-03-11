# Saved transcripts

Every completed transcription is saved on the server. You **don’t access files on Railway directly** — you use the app.

## How you see them

- **In the app:** Scroll to **“Saved transcripts”** at the bottom of the page. Each completed job appears as a row with the file name, “Processed in X.Xs”, and a **Download .txt** button. That’s the only place you need to look.
- **No variable required:** The app uses a default folder on the server. You don’t have to set `TRANSCRIPT_SAVE_DIR` or `UPLOAD_DIR` for the list to work.

## Why might “Saved transcripts” be empty?

1. **No job has finished yet**  
   A job only appears after it **completes** successfully. If you only ran one big file and it’s still transcribing (or failed), the list will be empty until a job finishes and is saved.

2. **The job failed before saving**  
   If the job failed (e.g. “Uploaded file not found”, API error), nothing is written to disk, so nothing shows in the list. Check the red error message on the page and Railway logs.

3. **Multiple replicas on Railway**  
   If the app runs on more than one replica, the replica that did the upload runs the worker and saves the transcript on **its** disk. When you load the page, you might hit a **different** replica that has no files. **Fix:** Use **1 replica** so the same container receives uploads, runs the worker, and serves the “Saved transcripts” list.

4. **List failed to load**  
   If the server can’t read the transcripts folder, the app may show an error in the “Saved transcripts” section. Check Railway logs for “Could not read transcripts folder” and that the app has write/read access to its data directory.

## Optional: where the server stores files

- **Default:** `{UPLOAD_DIR}/transcripts`, e.g. `/tmp/transcriber-uploads/transcripts` if `UPLOAD_DIR` is not set.
- **Override:** Set `TRANSCRIPT_SAVE_DIR` to an absolute path (e.g. a Railway volume path) if you want a specific location or to keep transcripts across deploys.

You still **access** transcripts only via the “Saved transcripts” box and the Download link — not by browsing the server filesystem.

## What’s written for each job

1. **`{timestamp}-{sanitized-name}.txt`** — Stats at the top, then plain transcript, then by-speaker transcript.
2. **`{timestamp}-{sanitized-name}.json`** — Data used by the app to build the list (and for download URL).

## Railway checklist

- **1 replica** so uploads and the list come from the same container.
- Start command: `node scripts/start.mjs` so the worker runs and saves transcripts.
- No need to set `TRANSCRIPT_SAVE_DIR` unless you want a custom path or a volume for persistence.
