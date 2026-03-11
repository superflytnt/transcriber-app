"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-8 shadow-lg">
        <h1 className="text-xl font-bold text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The app hit an error. Try refreshing the page.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Try again
        </button>
        <a
          href="/"
          className="mt-3 block w-full rounded-lg border border-zinc-600 px-4 py-2.5 text-center text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Back to Transcriber
        </a>
      </div>
    </main>
  );
}
