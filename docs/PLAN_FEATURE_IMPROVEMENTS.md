# Transcriber: Feature Improvements & Enhancements Plan

**Constraint:** All items must preserve current **speed** and **accuracy**. No changes to chunking logic, model choice, API usage, or worker concurrency.

**Summary:** Client-side and UX improvements only: better status visibility (elapsed time, polling heartbeat, long-file notice), copy/export polish (confirmation, filename from source, formats hint), usability (remember options, keyboard shortcut, leave prompt, clear session), and accessibility (ARIA, focus, reduced motion). Optional later: per-chunk progress if exposed by API, transcript search. Nothing in this plan touches the transcription pipeline.

---

## 1. Visibility & feedback (no backend change)

| Item | Description | Why safe |
|------|-------------|----------|
| **Elapsed timer** | Show "Elapsed: 0:42" (or similar) in the status strip while a job is uploading/queued/transcribing. Update every second from job start. | Client-only timer; no extra requests or server work. |
| **Last checked** | In status strip, show "Last checked 1s ago" (or "Polling…") so users see that the UI is alive. | Cosmetic; polling interval unchanged. |
| **Long-file message** | When file size > e.g. 20 MB, show one line: "Large file — transcription may take several minutes." | Static message; no new API or processing. |

---

## 2. Output & export (client-only)

| Item | Description | Why safe |
|------|-------------|----------|
| **Copy confirmation** | Brief toast or inline "Copied" after Copy button click. | UI only. |
| **Export filename from source** | Use original file name (sanitized) for downloads, e.g. `Meeting Notes - transcript.txt` instead of `transcript.txt`. | Client-side string; no server change. |
| **Supported formats in UI** | Small expandable or tooltip: "Accepted: m4a, mp3, wav, aac, webm, qta, flac, ogg, mp4, mpeg, mpga, mov." | Static text. |

---

## 3. Usability (no impact on pipeline)

| Item | Description | Why safe |
|------|-------------|----------|
| **Remember options** | Persist language hint and known speakers in `localStorage`; prefill on load. | Client-only; same values still sent per request. |
| **Keyboard shortcut** | e.g. Cmd/Ctrl+U to focus drop zone and open file picker (avoid Cmd+O so browser Open is unchanged). | Accessibility; same file flow. |
| **Before-unload prompt** | If a job is in progress or transcript is present and user navigates away, optional "Leave? Transcript may be lost." | Prevents accidental loss; no server change. |
| **Clear / New session** | Single "Clear" or "New transcription" that resets file, job, transcript, and error so user can start over. | State reset only. |

---

## 4. Accessibility & polish

| Item | Description | Why safe |
|------|-------------|----------|
| **ARIA for status** | `aria-live="polite"` (or `status`) on the status strip so screen readers announce "Uploading…", "Transcribing…", "Done". | Markup only. |
| **Focus after completion** | When job completes, move focus to the Transcript heading or first Copy button so keyboard users can act immediately. | Focus management only. |
| **Reduced motion** | Respect `prefers-reduced-motion` for the progress shimmer (e.g. show static bar or slow pulse). | CSS/JS only. |

---

## 5. Optional future (only if free)

| Item | Description | Why safe |
|------|-------------|----------|
| **Per-chunk progress** | If the worker/API ever exposes "chunk N of M", show it in the status line. Do not add polling just for this; only if already available. | No new server work; display only. |
| **Transcript search** | In-page Ctrl+F or a simple "Find in transcript" that highlights matches in the transcript textarea (or a read-only view). | Client-side search; no server. |

---

## Out of scope (would affect speed/accuracy or scope)

- Changing chunk size, model, or concurrency.
- Adding a second transcription engine or post-processing (e.g. punctuation model).
- Real-time streaming transcription (different product).
- Server-side export (e.g. generate DOCX on server); keep export client-side to avoid extra load.

---

## Implementation order (suggestion)

1. **Visibility:** Elapsed timer, last-checked, long-file message.  
2. **Usability:** Remember options, Clear/New session, copy confirmation.  
3. **Export:** Filename from source, supported-formats hint.  
4. **Accessibility:** ARIA status, focus after done, reduced motion.  
5. **Optional:** Per-chunk progress only when available; transcript search.

---

**Document:** `transcriber-app/docs/PLAN_FEATURE_IMPROVEMENTS.md`  
*Plan for review only. Do not execute without approval.*
