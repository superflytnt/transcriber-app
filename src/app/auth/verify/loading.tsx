export default function AuthVerifyLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />
      <p className="mt-4 text-zinc-400">Signing you in…</p>
    </div>
  );
}
