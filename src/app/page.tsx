"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDurationMs } from "@/lib/format-duration";


type Session = { email: string; isAdmin?: boolean } | null;
type SessionState = Session | "loading";

type SavedTranscript = {
  id: string;
  originalFileName: string;
  endToEndMs: number;
  endToEndSec: number;
  bottleneck?: string;
  createdAt: string;
  downloadUrl: string;
  speakers?: string[];
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

type FileInfo = {
  durationSeconds: number;
  sizeMb: number;
  chunkCount: number;
  durationFormatted: string;
};

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

/** Parse plain transcript section from saved full .txt. */
function parsePlainFromSavedTxt(content: string): string {
  const afterStats = content.split("--- Plain transcript ---\n\n")[1] ?? "";
  return (afterStats.split("\n\n--- By speaker ---\n\n")[0] ?? "").trim();
}

/** Strip speaker labels ("A: text" → "text") to get plain text from speaker text. */
function stripSpeakerLabels(speakerText: string): string {
  return speakerText
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf(": ");
      return i > 0 ? line.slice(i + 2) : line;
    })
    .join("\n");
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
  onSession: (email: string, isAdmin?: boolean) => void;
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
        const sessionRes = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = sessionRes.ok ? await sessionRes.json().catch(() => ({})) : {};
        onSession(data.email, !!sessionData.isAdmin);
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
        const sessionRes = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = sessionRes.ok ? await sessionRes.json().catch(() => ({})) : {};
        onSession(data.email, !!sessionData.isAdmin);
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
  /** 0–100 during upload when known; null before/after or when not computable. */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadTick, setUploadTick] = useState(0);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [jobFileName, setJobFileName] = useState<string | null>(null);
  const [savedTranscripts, setSavedTranscripts] = useState<SavedTranscript[]>([]);
  const [transcriptsLoadError, setTranscriptsLoadError] = useState<string | null>(null);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);
  const [copiedWhich, setCopiedWhich] = useState<"transcript" | "speaker" | null>(null);
  const [originalSpeakerText, setOriginalSpeakerText] = useState("");
  const [speakerRenames, setSpeakerRenames] = useState<Record<string, string>>({});
  const [savedDownloadOpenId, setSavedDownloadOpenId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadStartedAtRef = useRef<number>(0);
  const pollFailuresRef = useRef<number>(0);

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

  const [viewingTranscriptName, setViewingTranscriptName] = useState<string | null>(null);
  const [viewingTranscriptId, setViewingTranscriptId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSavedTranscripts = useCallback(async () => {
    if (!session || typeof session === "string") return;
    setTranscriptsLoadError(null);
    setTranscriptsLoading(true);
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
    } finally {
      setTranscriptsLoading(false);
    }
  }, [session]);

  const saveTranscriptToDisk = useCallback(async (id: string, newSpeakerText: string) => {
    setSaving(true);
    try {
      await fetch(`/api/transcripts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ speakerText: newSpeakerText }),
      });
      fetchSavedTranscripts();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }, [fetchSavedTranscripts]);

  const handleSpeakerRename = useCallback(
    (label: string, newName: string) => {
      const next = { ...speakerRenames, [label]: newName };
      setSpeakerRenames(next);
      const updated = applySpeakerRenames(originalSpeakerText, next);
      setSpeakerText(updated);

      if (viewingTranscriptId) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const id = viewingTranscriptId;
        saveTimerRef.current = setTimeout(() => {
          void saveTranscriptToDisk(id, updated);
        }, 800);
      }
    },
    [originalSpeakerText, speakerRenames, viewingTranscriptId, saveTranscriptToDisk]
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    fetch("/api/auth/session", { credentials: "include", signal: controller.signal })
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.email) setSession({ email: data.email, isAdmin: !!data.isAdmin });
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

  useEffect(() => {
    if (!savedDownloadOpenId) return;
    const onClick = () => setSavedDownloadOpenId(null);
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [savedDownloadOpenId]);

  const loadSavedTranscript = useCallback(async (t: SavedTranscript) => {
    try {
      const res = await fetch(t.downloadUrl, { credentials: "include" });
      if (!res.ok) return;
      const raw = await res.text();
      const bySpeaker = parseBySpeakerFromSavedTxt(raw);
      setText(bySpeaker);
      setOriginalSpeakerText(bySpeaker);
      setSpeakerText(bySpeaker);
      setSpeakerRenames({});
      setTimings(null);
      setViewingTranscriptName(t.originalFileName);
      setViewingTranscriptId(t.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (session && typeof session === "object") fetchSavedTranscripts();
  }, [session, fetchSavedTranscripts]);

  useEffect(() => {
    if (!session || typeof session !== "object") return;
    const onFocus = () => fetchSavedTranscripts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [session, fetchSavedTranscripts]);

  // When a job completes, refetch saved transcripts immediately and again after short delays
  // so the new transcript is visible even if the server write is slightly delayed.
  useEffect(() => {
    if (jobState !== "completed") return;
    fetchSavedTranscripts();
    const t1 = setTimeout(fetchSavedTranscripts, 1500);
    const t2 = setTimeout(fetchSavedTranscripts, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [jobState, fetchSavedTranscripts]);

  // Re-render periodically while uploading so "Starting job" appears after 45s if server is slow
  useEffect(() => {
    if (!isUploading) return;
    const id = setInterval(() => setUploadTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, [isUploading]);

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
        if (data.state === "failed") {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        setJobId(stored.jobId);
        setJobState(data.state);
        setJobProgress(data.progress ?? null);
        if (stored.fileName) setJobFileName(stored.fileName);
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
      if (!isAcceptedFile(audioFile)) {
        setError("Unsupported file format. Use one of: m4a, m4v, mp3, wav, aac, webm, qta, flac, ogg, mp4, mpeg, mpga, mov.");
        return;
      }
      setError(null);
      setJobId(null);
      setJobState(null);
      setJobProgress(null);
      setFileInfo(null);
      setJobFileName(null);
      setViewingTranscriptName(null);
      setViewingTranscriptId(null);
      setText("");
      setSpeakerText("");
      setOriginalSpeakerText("");
      setSpeakerRenames({});
      setTimings(null);
      setIsUploading(true);
      setUploadProgress(null);
      uploadStartedAtRef.current = Date.now();

      const form = new FormData();
      form.append("file", audioFile);
      form.append("languageHint", languageHint);
      form.append("knownSpeakerNames", knownSpeakers);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/jobs");
      xhr.withCredentials = true;

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.min(100, Math.round((100 * e.loaded) / e.total));
          setUploadProgress(pct);
        }
      });

      const done = () => {
        setIsUploading(false);
        setUploadProgress(null);
      };

      xhr.onload = () => {
        const contentType = xhr.getResponseHeader("content-type") ?? "";
        const raw = xhr.responseText;
        let data: { jobId?: string; error?: string; state?: JobState; result?: JobResponse["result"]; fileInfo?: FileInfo };
        try {
          if (!contentType.includes("application/json")) {
            setError("Something went wrong. Please try again.");
            done();
            return;
          }
          data = JSON.parse(raw) as typeof data;
        } catch {
          setError("Something went wrong. Please try again.");
          done();
          return;
        }
        if (xhr.status === 401) {
          setSession(null);
          done();
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          setError(toUserMessage(data.error ?? "Upload failed."));
          done();
          return;
        }
        if (!data.jobId) {
          setError("Something went wrong. Please try again.");
          done();
          return;
        }
        const id = data.jobId as string;
        setJobId(id);
        setJobFileName(audioFile.name);
        if (data.fileInfo) setFileInfo(data.fileInfo);
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
        } else {
          setJobState("waiting");
          setJobProgress(null);
        }
        done();
      };

      xhr.onerror = () => {
        setError("Something went wrong. Please check your connection and try again.");
        done();
      };

      xhr.ontimeout = () => {
        setError(
          "The request timed out. The server may still be processing your file — check Saved transcripts in a minute or refresh and try again. If it keeps happening, try a smaller file or check your connection."
        );
        done();
      };

      // 10 minutes: server returns as soon as file is saved (then transcription runs in background). Long timeout for slow uploads or slow server receive.
      xhr.timeout = 600_000;

      xhr.send(form);
    },
    [languageHint, knownSpeakers, setSession]
  );

  useEffect(() => {
    if (!jobId || jobState === "completed" || jobState === "failed") return;
    pollFailuresRef.current = 0;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        let data: JobResponse;
        try {
          data = (await res.json()) as JobResponse;
        } catch {
          pollFailuresRef.current = (pollFailuresRef.current ?? 0) + 1;
          if (pollFailuresRef.current >= 3) {
            setError("We couldn't check the status. Please refresh and try again.");
            setJobState("failed");
            localStorage.removeItem(STORAGE_KEY);
          }
          return;
        }
        pollFailuresRef.current = 0;
        if (!res.ok) {
          setError(toUserMessage((data as { error?: string }).error ?? "Something went wrong. Please try again."));
          setJobState("failed");
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        setJobState(data.state);
        setJobProgress(data.progress ?? null);
        if (data.state === "failed") {
          setError(toUserMessage(data.error ?? "Transcription failed."));
          localStorage.removeItem(STORAGE_KEY);
        }
        if (data.state === "completed" && data.result) {
          setText(data.result.text);
          setOriginalSpeakerText(data.result.speakerText);
          setSpeakerText(data.result.speakerText);
          setSpeakerRenames({});
          setTimings(data.result.timings ?? null);
          setViewingTranscriptName(null);
          setViewingTranscriptId(null);
        }
      } catch (err) {
        pollFailuresRef.current = (pollFailuresRef.current ?? 0) + 1;
        if (pollFailuresRef.current >= 3) {
          setError("Network error. Check your connection and try again.");
          setJobState("failed");
          localStorage.removeItem(STORAGE_KEY);
        }
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
  // One message per step: Upload → Queue → Transcribe. As soon as client hits 100% upload (or we've been waiting a long time), show Queue so we don't leave them stuck on "Upload" while server responds.
  const uploadWaitingLong = isUploading && uploadStartedAtRef.current > 0 && Date.now() - uploadStartedAtRef.current > 45_000;
  const step = isUploading
    ? (uploadProgress != null && uploadProgress >= 100 ? "queue" : uploadWaitingLong ? "queue" : "upload")
    : jobState === "waiting" || jobState === "delayed" || !jobState
      ? "queue"
      : jobState === "active" || jobState === "paused"
        ? "transcribe"
        : null;
  const statusLabel =
    step === "upload"
      ? uploadProgress != null && uploadProgress < 100
        ? `Uploading… ${uploadProgress}%`
        : "Uploading…"
      : step === "queue"
        ? isUploading
          ? "Starting job…"
          : `Waiting in queue…${jobFileName ? ` ${jobFileName}` : ""}`
        : step === "transcribe"
          ? jobState === "paused"
            ? "Paused"
            : `Transcribing…${progressSuffix}`
          : "";

  if (!session || typeof session !== "object") {
    return <LoginUI onSession={(email, isAdmin) => setSession({ email, isAdmin: !!isAdmin })} initialStep="email" initialEmail="" />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 px-6 py-8 shadow-lg">
          <div className="flex items-start justify-between gap-4 text-center">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
                Transcriber
              </h1>
              <p className="mt-2 text-zinc-400">
                Drop audio. We&apos;ll transcribe it.
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Fast · Accurate · Saved to your account
              </p>
            </div>
            {session.isAdmin && (
              <Link
                href="/admin"
                className="shrink-0 rounded-lg p-2 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
                title="Admin"
                aria-label="Admin settings"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 2.31.826 1.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 2.31-2.37 1.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-2.31-.826-1.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-2.31 2.37-1.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
            )}
          </div>
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
                {/* Steps: Upload → Queue → Transcribe */}
                <div className="flex items-center gap-2 text-xs">
                  <span className={step === "upload" ? "text-emerald-400 font-medium" : "text-zinc-500"}>
                    {step === "upload" ? "1. Upload" : "Upload ✓"}
                  </span>
                  <span className="text-zinc-600">→</span>
                  <span className={step === "queue" ? "text-emerald-400 font-medium" : "text-zinc-500"}>
                    {step === "queue" ? "2. Queue" : step === "upload" ? "Queue" : "Queue ✓"}
                  </span>
                  <span className="text-zinc-600">→</span>
                  <span className={step === "transcribe" ? "text-emerald-400 font-medium" : "text-zinc-500"}>
                    {step === "transcribe" ? "3. Transcribe" : step === "upload" || step === "queue" ? "Transcribe" : "Transcribe ✓"}
                  </span>
                </div>
                <span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />
                <p className="text-lg font-medium text-zinc-200">{statusLabel}</p>
                {fileInfo && (
                  <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
                    <span>{fileInfo.durationFormatted} duration</span>
                    <span className="text-zinc-600">·</span>
                    <span>{fileInfo.sizeMb} MB</span>
                    <span className="text-zinc-600">·</span>
                    <span>{fileInfo.chunkCount} {fileInfo.chunkCount === 1 ? "chunk" : "chunks"}</span>
                  </div>
                )}
                <p className={`text-xs text-zinc-500 text-center ${step === "queue" && isUploading ? "max-w-sm" : "max-w-xs"}`}>
                  {step === "upload"
                    ? "Large files can take 1–2 minutes."
                    : step === "queue" && isUploading
                      ? "Server is saving and queuing — large files can take a minute."
                      : "Transcription runs in the background — wait or come back later; status will still show."}
                </p>
                <div className="h-1.5 w-48 overflow-hidden rounded-full bg-zinc-700">
                  {step === "upload" && uploadProgress != null && uploadProgress < 100 ? (
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  ) : step === "queue" && isUploading ? (
                    <div className="h-full w-full rounded-full bg-emerald-500" title="Upload complete, waiting for server" />
                  ) : (
                    <div className="h-full w-full animate-shimmer rounded-full bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent bg-[length:200%_100%]" />
                  )}
                </div>
              </div>
            ) : !isBusy && (jobState === "completed" || jobState === "failed") ? (
              <div className="flex flex-col items-center gap-3 px-4">
                <p className="text-sm text-zinc-400">Drop another file to transcribe</p>
                {(file || jobFileName) && (
                  <span className="text-sm font-medium text-zinc-200 truncate max-w-xs" title={file?.name ?? jobFileName ?? ""}>
                    Last: {file?.name ?? jobFileName}
                  </span>
                )}
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

        {/* Error - impossible to miss (only when not showing the failed-job strip below) */}
        {error && jobState !== "failed" && (
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

        {/* Done / Failed state strip (single place for job outcome) */}
        {(jobState === "completed" || jobState === "failed") && (
          <div
            className={`mb-6 rounded-xl border px-4 py-3 ${
              jobState === "failed"
                ? "border-red-800 bg-red-950/30 text-red-200"
                : "border-emerald-800/60 bg-emerald-950/20 text-emerald-200"
            }`}
          >
            {jobState === "completed" ? (
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">Done</span>
                {jobFileName && (
                  <span className="text-emerald-300/90 truncate max-w-xs" title={jobFileName}>
                    · {jobFileName}
                  </span>
                )}
                {timings && (
                  <span className="text-emerald-300/90">
                    · Processed in {formatDurationMs(timings.endToEndMs)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="font-medium">Failed</span>
                </div>
                {error && <p className="text-sm text-red-300/90">{error}</p>}
              </div>
            )}
          </div>
        )}

        {/* Viewing saved transcript banner */}
        {viewingTranscriptName && !jobState && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-emerald-200">
            <svg className="h-5 w-5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Viewing</span>
            <span className="truncate text-emerald-300/90" title={viewingTranscriptName}>· {viewingTranscriptName}</span>
          </div>
        )}

        {/* Output */}
        {(text || speakerText) && (
          <section className="space-y-6">
            {/* Timing summary (admin only) */}
            {session.isAdmin && timings && (
              <div className="rounded-xl border-2 border-red-800/60 bg-zinc-900/40 p-4">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                  Timing Stats for Admins
                </h3>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
                  <span>Upload: {formatDurationMs(timings.uploadMs)}</span>
                  <span>Queue: {formatDurationMs(timings.queueWaitMs)}</span>
                  <span>Chunking: {formatDurationMs(timings.chunkingMs)}</span>
                  <span>API: {formatDurationMs(timings.perChunk.reduce((s, c) => s + c.totalMs, 0))}</span>
                  <span>Stitching: {formatDurationMs(timings.stitchingMs)}</span>
                  <span className="font-semibold text-zinc-200">
                    End-to-end: {formatDurationMs(timings.endToEndMs)}
                  </span>
                  {timings.bottleneck && (
                    <span className="text-amber-400">Bottleneck: {timings.bottleneck.replace("_", " ")}</span>
                  )}
                </div>
              </div>
            )}

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

            {/* Transcript */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-800/50 px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-zinc-200">Transcript</h2>
                    {viewingTranscriptId && (
                      <span className="text-xs text-zinc-500">{saving ? "Saving…" : "Auto-saved"}</span>
                    )}
                  </div>
                  {(viewingTranscriptName || jobFileName) && (
                    <p className="text-xs text-zinc-400 truncate max-w-xs" title={viewingTranscriptName ?? jobFileName ?? ""}>
                      {viewingTranscriptName ?? jobFileName}
                    </p>
                  )}
                </div>
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
                    onClick={() => downloadBlob(new Blob([stripSpeakerLabels(speakerText)], { type: "text/plain" }), "transcript-plain.txt")}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                    title="Text only, no speaker labels"
                  >
                    Plain
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadBlob(new Blob([speakerText], { type: "text/plain" }), "transcript.txt")}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                    title="With speaker labels (A: text)"
                  >
                    TXT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rows = speakerText
                        .split("\n")
                        .filter((line) => line.trim().length > 0)
                        .map((line) => {
                          const i = line.indexOf(": ");
                          const speaker = i > 0 ? line.slice(0, i).trim() : "";
                          const content = i > 0 ? line.slice(i + 2).trim() : line;
                          return `"${speaker.replace(/"/g, '""')}","${content.replace(/"/g, '""')}"`;
                        });
                      const header = "Speaker,Text\n";
                      downloadBlob(new Blob(["\uFEFF" + header + rows.join("\n")], { type: "text/csv" }), "transcript.csv");
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                    title="Spreadsheet with Speaker and Text columns"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const plain = stripSpeakerLabels(speakerText);
                      const json = JSON.stringify({ plainText: plain, speakerText, ...(timings ? { timings } : {}) }, null, 2);
                      downloadBlob(new Blob([json], { type: "application/json" }), "transcript.json");
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                    title="JSON with plain text and speaker text"
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
                        const plain = stripSpeakerLabels(speakerText);
                        const plainParas = plain
                          .split(/\r?\n/)
                          .map((line) => new Paragraph({ children: [new TextRun({ text: line || " " })] }));
                        const speakerParas = speakerText
                          .split(/\r?\n/)
                          .filter((l) => l.trim())
                          .map((line) => new Paragraph({ children: [new TextRun({ text: line })] }));
                        const doc = new Document({
                          sections: [{
                            children: [
                              new Paragraph({ text: "Transcript", heading: HeadingLevel.HEADING_1 }),
                              ...plainParas,
                              new Paragraph({ text: "" }),
                              new Paragraph({ text: "With speakers", heading: HeadingLevel.HEADING_1 }),
                              ...speakerParas,
                            ],
                          }],
                        });
                        downloadBlob(await Packer.toBlob(doc), "transcript.docx");
                      } catch (e) {
                        console.error("Word export failed:", e);
                      }
                    }}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                    title="Word doc with both plain and speaker sections"
                  >
                    Word
                  </button>
                </div>
              </div>
              <textarea
                value={speakerText}
                onChange={(e) => {
                  const val = e.target.value;
                  setSpeakerText(val);
                  if (viewingTranscriptId) {
                    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                    const id = viewingTranscriptId;
                    saveTimerRef.current = setTimeout(() => { void saveTranscriptToDisk(id, val); }, 800);
                  }
                }}
                className="min-h-[280px] w-full resize border-0 bg-transparent p-4 font-mono text-sm text-zinc-300 placeholder-zinc-500 focus:ring-0"
                placeholder="Speaker transcript…"
                title="Drag the corner to resize"
              />
            </div>
          </section>
        )}

        {/* Saved transcripts - your history */}
        <section className="mt-10 border-t border-zinc-800 pt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-200">Saved transcripts</h2>
            <button
              type="button"
              onClick={() => fetchSavedTranscripts()}
              disabled={transcriptsLoading}
              className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {transcriptsLoading ? "Loading…" : "Refresh list"}
            </button>
          </div>
          <p className="mb-4 text-sm text-zinc-500">
            Your transcription history. Each completed job is saved and listed here. You can download any transcript from this list.
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
          {transcriptsLoading && savedTranscripts.length === 0 ? (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-400">
              Loading your transcripts…
            </div>
          ) : savedTranscripts.length === 0 && !transcriptsLoadError ? (
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
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 transition-colors ${
                    viewingTranscriptId === t.id
                      ? "border-emerald-700 bg-emerald-950/30 ring-1 ring-emerald-700/40"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-800/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => loadSavedTranscript(t)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium text-zinc-200 hover:text-white" title={`${t.originalFileName} — click to view`}>
                      {t.originalFileName}
                      {viewingTranscriptId === t.id && (
                        <span className="ml-2 inline-block rounded bg-emerald-800/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                          Viewing
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Processed in <strong className="text-zinc-400">{formatDurationMs(t.endToEndMs)}</strong>
                      {" · "}
                      {new Date(t.createdAt).toLocaleString()}
                    </p>
                    {t.speakers && t.speakers.length > 0 && (
                      <p className="text-xs text-zinc-500">
                        {t.speakers.length} {t.speakers.length === 1 ? "Speaker" : "Speakers"}: <span className="text-zinc-400">{t.speakers.join(", ")}</span>
                      </p>
                    )}
                  </button>
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
                        {(["Plain", "With speakers", "CSV", "JSON", "Word"] as const).map((format) => (
                          <button
                            key={format}
                            type="button"
                            className="whitespace-nowrap px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700"
                            onClick={async () => {
                              setSavedDownloadOpenId(null);
                              const base = safeDownloadBasename(t.originalFileName);
                              try {
                                const res = await fetch(t.downloadUrl);
                                const raw = await res.text();
                                const bySpeaker = parseBySpeakerFromSavedTxt(raw);
                                const plain = parsePlainFromSavedTxt(raw) || stripSpeakerLabels(bySpeaker);
                                if (format === "Plain") {
                                  downloadBlob(new Blob([plain], { type: "text/plain" }), `${base}.txt`);
                                } else if (format === "With speakers") {
                                  downloadBlob(new Blob([bySpeaker], { type: "text/plain" }), `${base}-speakers.txt`);
                                } else if (format === "CSV") {
                                  const rows = bySpeaker
                                    .split("\n")
                                    .filter((line) => line.trim().length > 0)
                                    .map((line) => {
                                      const i = line.indexOf(": ");
                                      const speaker = i > 0 ? line.slice(0, i).trim() : "";
                                      const content = i > 0 ? line.slice(i + 2).trim() : line;
                                      return `"${speaker.replace(/"/g, '""')}","${content.replace(/"/g, '""')}"`;
                                    });
                                  downloadBlob(
                                    new Blob(["\uFEFFSpeaker,Text\n" + rows.join("\n")], { type: "text/csv" }),
                                    `${base}.csv`
                                  );
                                } else if (format === "JSON") {
                                  downloadBlob(
                                    new Blob([JSON.stringify({ plainText: plain, speakerText: bySpeaker }, null, 2)], { type: "application/json" }),
                                    `${base}.json`
                                  );
                                } else {
                                  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
                                  const plainParas = plain.split(/\r?\n/).map((line) => new Paragraph({ children: [new TextRun({ text: line || " " })] }));
                                  const speakerParas = bySpeaker.split(/\r?\n/).filter((l) => l.trim()).map((line) => new Paragraph({ children: [new TextRun({ text: line })] }));
                                  const doc = new Document({
                                    sections: [{
                                      children: [
                                        new Paragraph({ text: "Transcript", heading: HeadingLevel.HEADING_1 }),
                                        ...plainParas,
                                        new Paragraph({ text: "" }),
                                        new Paragraph({ text: "With speakers", heading: HeadingLevel.HEADING_1 }),
                                        ...speakerParas,
                                      ],
                                    }],
                                  });
                                  downloadBlob(await Packer.toBlob(doc), `${base}.docx`);
                                }
                              } catch (e) {
                                console.error("Download failed:", e);
                              }
                            }}
                          >
                            {format === "Plain" ? "Plain text (.txt)"
                              : format === "With speakers" ? "With speakers (.txt)"
                              : format === "CSV" ? "Spreadsheet (.csv)"
                              : format === "JSON" ? "JSON (.json)"
                              : "Word (.docx)"}
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
