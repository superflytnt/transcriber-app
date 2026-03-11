"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Session = { email: string } | null;
type SessionState = Session | "loading";

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

/** Parse "by speaker" section from saved full .txt (stats + plain + by speaker). */
function parseBySpeakerFromSavedTxt(content: string): string {
  const parts = content.split("\n\n--- By speaker ---\n\n");
  return (parts[1] ?? "").trim();
}

function safeDownloadBasename(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80);
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

function LoginUI({
  onSession,
  initialStep,
  initialEmail,
}: {
  onSession: (email: string) => void;
  initialStep: "email" | "check-email";
  initialEmail: string;
}) {
  const [step, setStep] = useState<"email" | "check-email">(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const [pendingEmail, setPendingEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showDevSignIn, setShowDevSignIn] = useState(false);
  const [devSigningIn, setDevSigningIn] = useState(false);

  const handleDevSignIn = useCallback(async () => {
    const e = email.trim();
    if (!e) {
      setSendError("Please enter your email.");
      return;
    }
    setSendError(null);
    setDevSigningIn(true);
    try {
      const res = await fetch("/api/auth/dev-sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.email === "string") {
        onSession(data.email);
      } else {
        setSendError((data.error as string) || "Sign-in failed.");
      }
    } catch {
      setSendError("Something went wrong.");
    } finally {
      setDevSigningIn(false);
    }
  }, [email, onSession]);

  const handleSendLink = useCallback(async () => {
    const e = email.trim();
    if (!e) {
      setSendError("Please enter your email.");
      return;
    }
    setSendError(null);
    setSending(true);
    try {
      const res = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPendingEmail(e);
        setStep("check-email");
      } else {
        const msg = (data.error as string) || "Failed to send. Try again.";
        const isNotConfigured = res.status === 503 || (data.code as string) === "EMAIL_NOT_CONFIGURED" || /not configured/i.test(msg);
        setSendError(isNotConfigured ? "This server can't send email yet." : msg);
        if (isNotConfigured) setShowDevSignIn(true);
      }
    } catch {
      setSendError("Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  }, [email]);

  const handleVerifyCode = useCallback(async () => {
    const c = code.replace(/\s/g, "");
    if (c.length !== 6) return;
    setCodeError(null);
    setVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.email === "string") {
        onSession(data.email);
      } else {
        setCodeError((data.error as string) || "Invalid or expired code. Request a new sign-in email.");
      }
    } catch {
      setCodeError("Something went wrong. Try again.");
    } finally {
      setVerifying(false);
    }
  }, [code, onSession]);

  if (step === "email") {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 px-6 py-8 shadow-lg">
          <h1 className="text-2xl font-bold tracking-tight text-white text-center">Transcriber</h1>
          <p className="mt-2 text-zinc-400 text-center text-sm">Sign in to upload and save transcripts.</p>
          <div className="mt-6">
            <label htmlFor="login-email" className="block text-xs font-medium text-zinc-500 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendLink()}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          {sendError && <p className="mt-2 text-sm text-red-400">{sendError}</p>}
          <button
            type="button"
            onClick={handleSendLink}
            disabled={sending}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Sending…" : "Send login link"}
          </button>
          {showDevSignIn && (
            <button
              type="button"
              onClick={handleDevSignIn}
              disabled={devSigningIn}
              className="mt-3 w-full rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {devSigningIn ? "Signing in…" : "Sign in without email (development)"}
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 px-6 py-8 shadow-lg">
        <h1 className="text-2xl font-bold tracking-tight text-white text-center">Check your email</h1>
        <p className="mt-2 text-zinc-400 text-center text-sm">
          We sent a sign-in link to <strong className="text-zinc-300">{pendingEmail}</strong>. Click the link in that email to sign in, or enter the 6-digit code below.
        </p>
        <div className="mt-6">
          <label htmlFor="login-code" className="block text-xs font-medium text-zinc-500 mb-1">
            6-digit code
          </label>
          <input
            id="login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-200 text-center text-lg tracking-widest placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        {codeError && <p className="mt-2 text-sm text-red-400">{codeError}</p>}
        <button
          type="button"
          onClick={handleVerifyCode}
          disabled={verifying || code.replace(/\s/g, "").length !== 6}
          className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {verifying ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => { setStep("email"); setCode(""); setCodeError(null); }}
          className="mt-3 w-full text-sm text-zinc-500 hover:text-zinc-400"
        >
          Use a different email
        </button>
      </div>
    </main>
  );
}

export default function Home() {
  const [session, setSession] = useState<SessionState>(null);
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
  const [savedDownloadOpenId, setSavedDownloadOpenId] = useState<string | null>(null);
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
    let cancelled = false;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    fetch("/api/auth/session", { credentials: "include", signal: controller.signal })
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.email) setSession({ email: data.email });
      })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(t);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setSession(null);
  }, []);

  useEffect(() => {
    if (copiedWhich == null) return;
    const t = setTimeout(() => setCopiedWhich(null), 2000);
    return () => clearTimeout(t);
  }, [copiedWhich]);

  const fetchSavedTranscripts = useCallback(async () => {
    if (!session || typeof session === "string") return;
    setTranscriptsLoadError(null);
    try {
      const res = await fetch("/api/transcripts", { credentials: "include" });
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
  }, [session]);

  useEffect(() => {
    if (session && typeof session === "object") fetchSavedTranscripts();
  }, [session, fetchSavedTranscripts]);

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
        let data: { jobId?: string; error?: string; state?: JobState; result?: JobResponse["result"] };
        try {
          if (!contentType.includes("application/json")) {
            setError("Something went wrong. Please try again.");
            return;
          }
          data = JSON.parse(raw) as typeof data;
        } catch {
          setError("Something went wrong. Please try again.");
          return;
        }

        if (!response.ok) {
          if (response.status === 401) {
            setSession(null);
            return;
          }
          setError(toUserMessage(data.error ?? "Upload failed."));
          return;
        }
        if (!data.jobId) {
          setError("Something went wrong. Please try again.");
          return;
        }
        const id = data.jobId as string;
        setJobId(id);
        setJobFileName(audioFile.name);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: id, fileName: audioFile.name }));
        } catch {
          // ignore
        }
        if (data.state === "completed" && data.result) {
          setJobState("completed");
          setJobProgress(null);
          setText(data.result.text);
          setOriginalSpeakerText(data.result.speakerText);
          setSpeakerText(data.result.speakerText);
          setSpeakerRenames({});
          setTimings(data.result.timings ?? null);
          return;
        }
        setJobState("waiting");
        setJobProgress(null);
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
    [languageHint, knownSpeakers, setSession]
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

  if (!session || typeof session !== "object") {
    return <LoginUI onSession={(email) => setSession({ email })} initialStep="email" initialEmail="" />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 px-6 py-8 text-center shadow-lg">
          <h1 className="m-0 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
            Transcriber
          </h1>
          <p className="mt-2 text-zinc-400">
            Drop audio. We&apos;ll transcribe it.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Fast · Accurate · Saved to your account
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
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
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
                className="min-h-[320px] w-full resize border-0 bg-transparent p-4 text-zinc-200 placeholder-zinc-500 focus:ring-0"
                placeholder="Transcript will appear here…"
                title="Drag the corner to resize"
              />
            </div>

            {/* Rename speakers - show whenever there are speaker labels (A, B, C, …) */}
            {speakerLabels.length >= 1 && (
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
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-800/50 px-4 py-3">
                <h2 className="font-semibold text-zinc-200">By speaker</h2>
                <div className="flex flex-wrap items-center gap-2">
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
                  <button
                    type="button"
                    onClick={() => downloadBlob(new Blob([speakerText], { type: "text/plain" }), "by-speaker.txt")}
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
                          : [];
                      const header = "Speaker,Text\n";
                      const csvBody = rows.join("\n");
                      downloadBlob(new Blob(["\uFEFF" + header + csvBody], { type: "text/csv" }), "by-speaker.csv");
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const json = JSON.stringify(
                        timings ? { speakerText, timings } : { speakerText },
                        null,
                        2
                      );
                      downloadBlob(new Blob([json], { type: "application/json" }), "by-speaker.json");
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
                        const speakerParas = speakerText
                          .split(/\r?\n/)
                          .filter((l) => l.trim())
                          .map((line) => new Paragraph({ children: [new TextRun({ text: line })] }));
                        const doc = new Document({
                          sections: [
                            {
                              children: [
                                new Paragraph({
                                  text: "By speaker",
                                  heading: HeadingLevel.HEADING_1,
                                }),
                                ...speakerParas,
                              ],
                            },
                          ],
                        });
                        const blob = await Packer.toBlob(doc);
                        downloadBlob(blob, "by-speaker.docx");
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
                value={speakerText}
                onChange={(e) => setSpeakerText(e.target.value)}
                className="min-h-[280px] w-full resize border-0 bg-transparent p-4 font-mono text-sm text-zinc-300 placeholder-zinc-500 focus:ring-0"
                placeholder="Speaker transcript…"
                title="Drag the corner to resize"
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
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setSavedDownloadOpenId((id) => (id === t.id ? null : t.id))}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                    >
                      Download ▾
                    </button>
                    {savedDownloadOpenId === t.id && (
                      <div className="absolute right-0 top-full z-10 mt-1 flex flex-col rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                        <a
                          href={t.downloadUrl}
                          download
                          className="whitespace-nowrap px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700"
                          onClick={() => setSavedDownloadOpenId(null)}
                        >
                          Full transcript (.txt)
                        </a>
                        {(["TXT", "CSV", "JSON", "Word"] as const).map((format) => (
                          <button
                            key={format}
                            type="button"
                            className="whitespace-nowrap px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700"
                            onClick={async () => {
                              setSavedDownloadOpenId(null);
                              const base = safeDownloadBasename(t.originalFileName);
                              try {
                                const res = await fetch(t.downloadUrl);
                                const content = await res.text();
                                const speakerText = parseBySpeakerFromSavedTxt(content);
                                if (format === "TXT") {
                                  downloadBlob(
                                    new Blob([speakerText], { type: "text/plain" }),
                                    `${base}-by-speaker.txt`
                                  );
                                } else if (format === "CSV") {
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
                                      : [];
                                  const header = "Speaker,Text\n";
                                  const csvBody = rows.join("\n");
                                  downloadBlob(
                                    new Blob(["\uFEFF" + header + csvBody], { type: "text/csv" }),
                                    `${base}-by-speaker.csv`
                                  );
                                } else if (format === "JSON") {
                                  const json = JSON.stringify({ speakerText }, null, 2);
                                  downloadBlob(
                                    new Blob([json], { type: "application/json" }),
                                    `${base}-by-speaker.json`
                                  );
                                } else {
                                  const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
                                    await import("docx");
                                  const speakerParas = speakerText
                                    .split(/\r?\n/)
                                    .filter((l) => l.trim())
                                    .map((line) =>
                                      new Paragraph({ children: [new TextRun({ text: line })] })
                                    );
                                  const doc = new Document({
                                    sections: [
                                      {
                                        children: [
                                          new Paragraph({
                                            text: "By speaker",
                                            heading: HeadingLevel.HEADING_1,
                                          }),
                                          ...speakerParas,
                                        ],
                                      },
                                    ],
                                  });
                                  const blob = await Packer.toBlob(doc);
                                  downloadBlob(blob, `${base}-by-speaker.docx`);
                                }
                              } catch (e) {
                                console.error("Download failed:", e);
                              }
                            }}
                          >
                            {format === "TXT"
                              ? "By speaker (.txt)"
                              : format === "Word"
                                ? "Word (.docx)"
                                : format}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Account - bottom of page */}
        <footer className="mt-10 border-t border-zinc-800 pt-8 flex flex-col items-center gap-2 text-center">
          <span className="text-sm text-zinc-400">Signed in as {session.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
          >
            Sign out
          </button>
        </footer>
      </div>

    </main>
  );
}
