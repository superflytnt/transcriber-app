"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SavedTranscript = {
  id: string;
  originalFileName: string;
  endToEndSec: number;
  bottleneck?: string;
  createdAt: string;
  downloadUrl: string;
};

const ACCEPT_AUDIO =
  ".m4a,.m4v,.mp3,.wav,.aac,.webm,.qta,.flac,.ogg,.mp4,.mpeg,.mpga,.mov";

type JobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";

type JobTimings = {
  uploadMs: number;
  queueWaitMs: number;
  chunkingMs: number;
  chunkCount: number;
  perChunk: Array<{ chunkIndex: number; totalMs: number; chunkSizeMb?: number }>;
  stitchingMs: number;
  transcriptionOnlyMs: number;
  endToEndMs: number;
  bottleneck?: string;
};

type JobProgress = { chunk?: number; total?: number };

type JobResponse = {
  state: JobState;
  progress?: JobProgress;
  error?: string;
  result?: {
    text: string;
    speakerText: string;
    timings?: JobTimings;
  };
};

const STORAGE_KEY = "transcriber_current_job";

const ALLOWED_EXTENSIONS = ACCEPT_AUDIO.split(",").map((x) => x.trim());

function isAcceptedFile(file: File): boolean {
  if (!file.name || file.name.trim() === "") return false;
  const name = file.name.trim().toLowerCase();
  const ext = "." + (name.split(".").pop() ?? "").trim();
  if (ALLOWED_EXTENSIONS.includes(ext)) return true;
  if (name.includes(".")) {
    for (const allowed of ALLOWED_EXTENSIONS) {
      if (name.endsWith(allowed)) return true;
    }
  }
  if ((file.type || "").toLowerCase().startsWith("audio/")) return true;
  return false;
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Show only user-friendly messages; hide technical/server details. */
function toUserMessage(serverError: string | undefined): string {
  if (!serverError?.trim()) return "Something went wrong. Please try again.";
  const s = serverError.trim();
  if (/REDIS|ENOENT|ECONNREFUSED|required\.|Invalid response|job ID returned/i.test(s))
    return "Something went wrong. Please try again.";
  if (/timeout|timed out|504/i.test(s))
    return "The request took too long. Please try again.";
  if (s.length > 120 || /^\w+Error:|at \s+\S+\.\w+\(/i.test(s))
    return "Something went wrong. Please try again.";
  return s;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [languageHint, setLanguageHint] = useState("");
  const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
    { value: "", label: "Auto-detect" },
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
    { value: "de", label: "German" },
    { value: "it", label: "Italian" },
    { value: "pt", label: "Portuguese" },
    { value: "nl", label: "Dutch" },
    { value: "pl", label: "Polish" },
    { value: "ru", label: "Russian" },
    { value: "ja", label: "Japanese" },
    { value: "zh", label: "Chinese" },
    { value: "ko", label: "Korean" },
    { value: "ar", label: "Arabic" },
    { value: "hi", label: "Hindi" },
  ];
  const [knownSpeakers, setKnownSpeakers] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [speakerText, setSpeakerText] = useState("");
  const [timings, setTimings] = useState<JobTimings | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [jobFileName, setJobFileName] = useState<string | null>(null);
  const [savedTranscripts, setSavedTranscripts] = useState<SavedTranscript[]>([]);
  const [transcriptsLoadError, setTranscriptsLoadError] = useState<string | null>(null);
  const [copiedWhich, setCopiedWhich] = useState<"transcript" | "speaker" | null>(null);
  const [originalSpeakerText, setOriginalSpeakerText] = useState("");
  const [speakerRenames, setSpeakerRenames] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applySpeakerRenames(baseText: string, renames: Record<string, string>): string {
    return baseText
      .split(/\r?\n/)
      .map((line) => {
        const idx = line.indexOf(": ");
        if (idx <= 0) return line;
        const label = line.slice(0, idx);
        const rest = line.slice(idx);
        const newName = renames[label]?.trim();
        return (newName ? newName : label) + rest;
      })
      .join("\n");
  }

  const speakerLabels = useMemo(() => {
    const set = new Set<string>();
    for (const line of originalSpeakerText.split(/\r?\n/)) {
      const idx = line.indexOf(": ");
      if (idx > 0) set.add(line.slice(0, idx));
    }
    return Array.from(set).sort();
  }, [originalSpeakerText]);

  const handleSpeakerRename = useCallback(
    (label: string, newName: string) => {
      const next = { ...speakerRenames, [label]: newName };
      setSpeakerRenames(next);
      setSpeakerText(applySpeakerRenames(originalSpeakerText, next));
    },
    [originalSpeakerText, speakerRenames]
  );

  useEffect(() => {
    if (copiedWhich == null) return;
    const t = setTimeout(() => setCopiedWhich(null), 2000);
    return () => clearTimeout(t);
  }, [copiedWhich]);

  const fetchSavedTranscripts = useCallback(async () => {
    setTranscriptsLoadError(null);
    try {
      const res = await fetch("/api/transcripts");
      if (res.ok) {
        const data = await res.json();
        setSavedTranscripts(data.transcripts ?? []);
      } else {
        const msg = (await res.json().catch(() => ({})))?.error ?? "Could not load saved transcripts.";
        setTranscriptsLoadError(msg);
        setSavedTranscripts([]);
      }
    } catch {
      setTranscriptsLoadError("Could not load saved transcripts. Check your connection.");
      setSavedTranscripts([]);
    }
  }, []);

  useEffect(() => {
    fetchSavedTranscripts();
  }, [fetchSavedTranscripts]);

  useEffect(() => {
    if (jobState === "completed") fetchSavedTranscripts();
  }, [jobState, fetchSavedTranscripts]);

  // Restore in-progress or last job from localStorage so refresh/return still shows status
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let stored: { jobId: string; fileName?: string };
    try {
      stored = JSON.parse(raw) as { jobId: string; fileName?: string };
    } catch {
      return;
    }
    if (!stored?.jobId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${stored.jobId}`);
        const data = (await res.json()) as JobResponse & { error?: string };
        if (cancelled) return;
        if (res.status === 404) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        setJobId(stored.jobId);
        setJobState(data.state);
        setJobProgress(data.progress ?? null);
        if (stored.fileName) setJobFileName(stored.fileName);
        if (data.state === "failed") setError(toUserMessage(data.error ?? "Transcription failed."));
        if (data.state === "completed" && data.result) {
          setText(data.result.text);
          setOriginalSpeakerText(data.result.speakerText);
          setSpeakerText(data.result.speakerText);
          setSpeakerRenames({});
          setTimings(data.result.timings ?? null);
        }
      } catch {
        if (!cancelled) localStorage.removeItem(STORAGE_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startTranscription = useCallback(
    async (audioFile: File) => {
      if (!audioFile.name?.trim()) {
        setError("Please choose a file with a name.");
        return;
      }
      if (audioFile.size === 0) {
        setError("File is empty. Please choose an audio file with content.");
        return;
      }
      setError(null);
      setJobId(null);
      setJobState(null);
      setJobProgress(null);
      setJobFileName(null);
      setText("");
      setSpeakerText("");
      setOriginalSpeakerText("");
      setSpeakerRenames({});
      setTimings(null);
      setIsUploading(true);

      try {
        const form = new FormData();
        form.append("file", audioFile);
        form.append("languageHint", languageHint);
        form.append("knownSpeakerNames", knownSpeakers);

        const response = await fetch("/api/jobs", { method: "POST", body: form });
        const contentType = response.headers.get("content-type") ?? "";
        const raw = await response.text();
        let data: { jobId?: string; error?: string };
        try {
          if (!contentType.includes("application/json")) {
            setError("Something went wrong. Please try again.");
            return;
          }
          data = JSON.parse(raw) as { jobId?: string; error?: string };
        } catch {
          setError("Something went wrong. Please try again.");
          return;
        }

        if (!response.ok) {
          setError(toUserMessage(data.error ?? "Upload failed."));
          return;
        }
        if (!data.jobId) {
          setError("Something went wrong. Please try again.");
          return;
        }
        const id = data.jobId as string;
        setJobId(id);
        setJobState("waiting");
        setJobProgress(null);
        setJobFileName(audioFile.name);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: id, fileName: audioFile.name }));
        } catch {
          // ignore
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isTimeout = /timeout|timed out|504/i.test(msg);
        setError(
          isTimeout
            ? "Upload took too long. Large files can take several minutes. Please try again."
            : "Something went wrong. Please check your connection and try again."
        );
      } finally {
        setIsUploading(false);
      }
    },
    [languageHint, knownSpeakers]
  );

  useEffect(() => {
    if (!jobId || jobState === "completed" || jobState === "failed") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        let data: JobResponse;
        try {
          data = (await res.json()) as JobResponse;
        } catch {
          setError("We couldn't check the status. Please refresh and try again.");
          setJobState("failed");
          return;
        }
        if (!res.ok) {
          setError(toUserMessage((data as { error?: string }).error ?? "Something went wrong. Please try again."));
          setJobState("failed");
          return;
        }
        setJobState(data.state);
        setJobProgress(data.progress ?? null);
        if (data.state === "failed") setError(toUserMessage(data.error ?? "Transcription failed."));
        if (data.state === "completed" && data.result) {
          setText(data.result.text);
          setOriginalSpeakerText(data.result.speakerText);
          setSpeakerText(data.result.speakerText);
          setSpeakerRenames({});
          setTimings(data.result.timings ?? null);
        }
      } catch (err) {
        setError("Network error. Check your connection and try again.");
        setJobState("failed");
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [jobId, jobState]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      if (!dropped) return;
      setError(null);
      setFile(dropped);
      startTranscription(dropped);
    },
    [startTranscription]
  );

  const handleFileSelect = useCallback(
    (selected: File | null) => {
      if (selected === null && (isUploading || (jobId != null && jobState !== "completed" && jobState !== "failed"))) {
        return;
      }
      setFile(selected);
      if (selected) {
        setError(null);
        startTranscription(selected);
      }
    },
    [startTranscription, isUploading, jobId, jobState]
  );

  const isBusy = isUploading || (jobId && jobState !== "completed" && jobState !== "failed");
  const progressSuffix =
    jobProgress?.total != null && jobProgress.total > 0 && (jobProgress.chunk ?? 0) > 0
      ? ` (chunk ${jobProgress.chunk} of ${jobProgress.total})`
      : jobFileName
        ? ` (${jobFileName})`
        : "";
  const statusLabel =
    isUploading
      ? "Uploading…"
      : jobState === "waiting" || jobState === "delayed" || !jobState
        ? `Waiting in queue…${jobFileName ? ` ${jobFileName}` : ""}`
        : jobState === "active" || jobState === "paused"
          ? jobState === "paused"
            ? "Paused"
            : `Transcribing…${progressSuffix}`
          : "";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 px-6 py-8 text-center shadow-lg">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Transcriber
          </h1>
          <p className="mt-2 text-zinc-400">
            Drop audio. We&apos;ll transcribe it.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Fast · Accurate · Saved to folder with stats
          </p>
        </header>

        {/* Drop zone - hero */}
        <div className="relative mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_AUDIO}
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            className="sr-only"
            aria-label="Choose audio file"
          />
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onClick={() => !isBusy && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
            }}
            onDrop={handleDrop}
            className={`relative flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-200 ${
              isBusy
                ? "cursor-not-allowed border-zinc-600 bg-zinc-900/50 opacity-80"
                : isDragOver
                  ? "border-emerald-400 bg-emerald-500/10 scale-[1.02]"
                  : "cursor-pointer border-zinc-500 bg-zinc-800/60 hover:border-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {isBusy ? (
              <div className="flex flex-col items-center gap-4">
                <span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />
                <p className="text-lg font-medium text-zinc-200">{statusLabel}</p>
                <p className="text-xs text-zinc-500 text-center max-w-xs">
                  Transcription runs in the background — wait or come back later; status will still show.
                </p>
                <div className="h-1.5 w-48 overflow-hidden rounded-full bg-zinc-700">
                  <div className="h-full w-full animate-shimmer rounded-full bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent bg-[length:200%_100%]" />
                </div>
              </div>
            ) : file && !isBusy && (jobState === "completed" || jobState === "failed") ? (
              <div className="flex flex-col items-center gap-3 px-4">
                <p className="text-sm text-zinc-400">Drop another file to transcribe</p>
                <span className="text-sm font-medium text-zinc-200 truncate max-w-xs" title={file.name}>
                  Last: {file.name}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600"
                >
                  Choose file
                </button>
              </div>
            ) : (
              <>
                <div className={`rounded-full p-4 ${isDragOver ? "bg-emerald-500/20" : "bg-zinc-700/50"}`}>
                  <svg
                    className={`h-10 w-10 ${isDragOver ? "text-emerald-400" : "text-zinc-400"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>
                <p className="text-xl font-semibold text-zinc-200">
                  {isDragOver ? "Drop to start" : "Drop your audio here"}
                </p>
                <p className="text-sm text-zinc-500">or click to choose a file · starts automatically</p>
                <p className="text-xs text-zinc-600 mt-1">Supported: m4a, m4v, mp3, wav, aac, webm, qta, flac, ogg, mp4, mpeg, mpga, mov</p>
              </>
            )}
          </div>
        </div>

        {/* Optional options - compact */}
        <details className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <summary className="cursor-pointer px-4 py-3 text-sm text-zinc-400 hover:text-zinc-300">
            Optional: language & speaker names
          </summary>
          <div className="space-y-3 border-t border-zinc-800 px-4 py-3">
            <label className="block text-xs font-medium text-zinc-500 mb-1">Language</label>
            <select
              value={languageHint}
              onChange={(e) => setLanguageHint(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value || "auto"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Known speakers (comma-separated)</label>
            <input
              value={knownSpeakers}
              onChange={(e) => setKnownSpeakers(e.target.value)}
              placeholder="e.g. Seth, Guest"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500"
            />
          </div>
        </details>

        {/* Error - impossible to miss */}
        {error && (
          <div className="mb-6 rounded-xl border-2 border-red-500 bg-red-950/60 px-5 py-4 shadow-lg ring-2 ring-red-500/20">
            <p className="font-semibold text-red-100">Error</p>
            <p className="mt-1 text-red-200">{error}</p>
            {/format|unsupported|supported:|m4a|mp3|wav|aac|webm|flac|ogg|mp4|mpeg|mov/i.test(error) && !/Use one of:/.test(error) && (
              <p className="mt-2 text-sm text-red-300/90">
                Supported: m4a, m4v, mp3, wav, aac, webm, qta, flac, ogg, mp4, mpeg, mpga, mov. Try again with one of these.
              </p>
            )}
          </div>
        )}

        {/* Done state strip */}
        {jobId && (jobState === "completed" || jobState === "failed") && (
          <div
            className={`mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 ${
              jobState === "failed"
                ? "border-red-800 bg-red-950/30 text-red-200"
                : "border-emerald-800/60 bg-emerald-950/20 text-emerald-200"
            }`}
          >
            {jobState === "completed" ? (
              <>
                <svg className="h-5 w-5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">Done</span>
                {timings && (
                  <span className="text-emerald-300/90">
                    · Processed in {(timings.endToEndMs / 1000).toFixed(1)}s
                  </span>
                )}
              </>
            ) : (
              <>
                <svg className="h-5 w-5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="font-medium">Failed</span>
              </>
            )}
          </div>
        )}

        {/* Output */}
        {(text || speakerText) && (
          <section className="space-y-6">
            {/* Timing summary */}
            {timings && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                  Timing
                </h3>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
                  <span>Upload: {(timings.uploadMs / 1000).toFixed(2)}s</span>
                  <span>Queue: {(timings.queueWaitMs / 1000).toFixed(2)}s</span>
                  <span>Chunking: {(timings.chunkingMs / 1000).toFixed(2)}s</span>
                  <span>API: {(timings.perChunk.reduce((s, c) => s + c.totalMs, 0) / 1000).toFixed(2)}s</span>
                  <span>Stitching: {(timings.stitchingMs / 1000).toFixed(2)}s</span>
                  <span className="font-semibold text-zinc-200">
                    End-to-end: {(timings.endToEndMs / 1000).toFixed(2)}s
                  </span>
                  {timings.bottleneck && (
                    <span className="text-amber-400">Bottleneck: {timings.bottleneck.replace("_", " ")}</span>
                  )}
                </div>
              </div>
            )}

            {/* Transcript - plain text */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-800/50 px-4 py-3">
                <h2 className="font-semibold text-zinc-200">Transcript</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(text).then(() => setCopiedWhich("transcript"));
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      copiedWhich === "transcript"
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-700 hover:bg-zinc-600"
                    }`}
                  >
                    {copiedWhich === "transcript" ? "Copied!" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadBlob(new Blob([text], { type: "text/plain" }), "transcript.txt")}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                  >
                    TXT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rows =
                        speakerText.trim().length > 0
                          ? speakerText
                              .split("\n")
                              .filter((line) => line.trim().length > 0)
                              .map((line) => {
                                const i = line.indexOf(":");
                                const speaker = i >= 0 ? line.slice(0, i).trim() : "";
                                const content = i >= 0 ? line.slice(i + 1).trim() : line;
                                return `"${speaker.replace(/"/g, '""')}","${content.replace(/"/g, '""')}"`;
                              })
                          : [[`"${text.replace(/"/g, '""')}"`]];
                      const header = speakerText.trim().length > 0 ? "Speaker,Text\n" : "Text\n";
                      const csvBody = Array.isArray(rows[0]) ? (rows as string[][]).map((r) => r.join(",")).join("\n") : (rows as string[]).join("\n");
                      downloadBlob(new Blob(["\uFEFF" + header + csvBody], { type: "text/csv" }), "transcript.csv");
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const json = JSON.stringify({ text, speakerText, timings }, null, 2);
                      downloadBlob(new Blob([json], { type: "application/json" }), "transcript.json");
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
                        const transcriptParas = text
                          .split(/\r?\n/)
                          .map((line) => new Paragraph({ children: [new TextRun({ text: line || " " })] }));
                        const children: (typeof transcriptParas)[0][] = [
                          new Paragraph({
                            text: "Transcript",
                            heading: HeadingLevel.HEADING_1,
                          }),
                          ...transcriptParas,
                        ];
                        if (speakerText.trim()) {
                          const speakerParas = speakerText
                            .split(/\r?\n/)
                            .filter((l) => l.trim())
                            .map((line) => new Paragraph({ children: [new TextRun({ text: line })] }));
                          children.push(
                            new Paragraph({ text: "" }),
                            new Paragraph({
                              text: "By speaker",
                              heading: HeadingLevel.HEADING_1,
                            }),
                            ...speakerParas
                          );
                        }
                        const doc = new Document({
                          sections: [{ children }],
                        });
                        const blob = await Packer.toBlob(doc);
                        downloadBlob(blob, "transcript.docx");
                      } catch (e) {
                        console.error("Word export failed:", e);
                      }
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                  >
                    Word
                  </button>
                </div>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[180px] w-full resize-y border-0 bg-transparent p-4 text-zinc-200 placeholder-zinc-500 focus:ring-0"
                placeholder="Transcript will appear here…"
              />
            </div>

            {/* Rename speakers - only when multiple speakers */}
            {speakerLabels.length >= 2 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4">
                <h3 className="mb-3 text-sm font-semibold text-zinc-300">Rename speakers</h3>
                <p className="mb-3 text-xs text-zinc-500">
                  Change a label to a real name; all lines with that speaker update below.
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {speakerLabels.map((label) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-sm text-zinc-400">{label}</span>
                      <span className="text-zinc-600">→</span>
                      <input
                        type="text"
                        value={speakerRenames[label] ?? ""}
                        onChange={(e) => handleSpeakerRename(label, e.target.value)}
                        placeholder="Name"
                        className="w-32 rounded-lg border border-zinc-600 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Speaker transcript */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-800/50 px-4 py-3">
                <h2 className="font-semibold text-zinc-200">By speaker</h2>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(speakerText).then(() => setCopiedWhich("speaker"));
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    copiedWhich === "speaker"
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-700 hover:bg-zinc-600"
                  }`}
                >
                  {copiedWhich === "speaker" ? "Copied!" : "Copy"}
                </button>
              </div>
              <textarea
                value={speakerText}
                onChange={(e) => setSpeakerText(e.target.value)}
                className="min-h-[160px] w-full resize-y border-0 bg-transparent p-4 font-mono text-sm text-zinc-300 placeholder-zinc-500 focus:ring-0"
                placeholder="Speaker transcript…"
              />
            </div>
          </section>
        )}

        {/* Saved transcripts - persisted to server folder */}
        <section className="mt-10 border-t border-zinc-800 pt-8">
          <h2 className="mb-3 text-lg font-semibold text-zinc-200">Saved transcripts</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Each completed job is saved and listed here. You can download any transcript from this list.
          </p>
          {transcriptsLoadError && (
            <div className="mb-4 rounded-xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
              <p>{transcriptsLoadError}</p>
              <button
                type="button"
                onClick={() => fetchSavedTranscripts()}
                className="mt-2 rounded-lg bg-amber-700/60 px-3 py-1.5 text-xs font-medium hover:bg-amber-700"
              >
                Retry
              </button>
            </div>
          )}
          {savedTranscripts.length === 0 && !transcriptsLoadError ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
              <p>No saved transcripts yet. Complete a transcription to see it here.</p>
              <p className="mt-2 text-xs text-zinc-600">
                Only successfully completed jobs appear. If you just finished one and don&apos;t see it, wait a moment and refresh, or check for an error message above.
              </p>
            </div>
          ) : savedTranscripts.length > 0 ? (
            <ul className="space-y-2">
              {savedTranscripts.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200" title={t.originalFileName}>
                      {t.originalFileName}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Processed in <strong className="text-zinc-400">{t.endToEndSec}s</strong>
                      {t.bottleneck && (
                        <span className="ml-2">· {t.bottleneck.replace("_", " ")}</span>
                      )}
                      {" · "}
                      {new Date(t.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <a
                    href={t.downloadUrl}
                    download
                    className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Download .txt
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

    </main>
  );
}
