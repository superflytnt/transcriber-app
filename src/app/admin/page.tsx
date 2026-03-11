"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 25;

type UserRow = { email: string; isAdmin: boolean };

export default function AdminPage() {
  const [session, setSession] = useState<{ email: string; isAdmin: boolean } | null | "loading">("loading");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (cancelled ? undefined : r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.email) setSession({ email: data.email, isAdmin: !!data.isAdmin });
        else setSession(null);
      })
      .finally(() => {
        if (!cancelled) setSession((s) => (s === "loading" ? null : s));
      });
    return () => { cancelled = true; };
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/admin/users?${params}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data.error as string) || "Failed to load users.");
        setUsers([]);
        setTotal(0);
        return;
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Failed to load users.");
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (session === "loading" || (session && !session.isAdmin)) return;
    if (session && session.isAdmin) fetchUsers();
  }, [session, fetchUsers]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleSetAdmin = useCallback(async (email: string, isAdmin: boolean) => {
    setToggling(email);
    try {
      const res = await fetch("/api/admin/set-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, isAdmin }),
      });
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, isAdmin } : u)));
      }
    } finally {
      setToggling(null);
    }
  }, []);

  if (session === "loading") {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />
      </main>
    );
  }

  if (!session || !session.isAdmin) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
        <p className="text-zinc-400">You don’t have access to this page.</p>
        <Link href="/" className="mt-4 text-emerald-400 hover:underline">Back to Transcriber</Link>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin</h1>
            <p className="mt-1 text-sm text-zinc-500">User list and admin flags</p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Back to Transcriber
          </Link>
        </header>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-zinc-200">Users</h2>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Search by email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <span className="text-sm text-zinc-500">
              {total} user{total !== 1 ? "s" : ""}
            </span>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-zinc-500">
                      <th className="pb-2 pr-4 font-medium">Email</th>
                      <th className="pb-2 font-medium">Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.email} className="border-b border-zinc-800">
                        <td className="py-3 pr-4 text-zinc-200">{u.email}</td>
                        <td className="py-3">
                          <button
                            type="button"
                            disabled={toggling === u.email}
                            onClick={() => handleSetAdmin(u.email, !u.isAdmin)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                              u.isAdmin
                                ? "bg-emerald-600/80 text-white hover:bg-emerald-600"
                                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                            } ${toggling === u.email ? "opacity-60" : ""}`}
                          >
                            {toggling === u.email ? "…" : u.isAdmin ? "Admin" : "Make admin"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {users.length === 0 && !error && (
                <p className="py-6 text-center text-zinc-500">No users match your search.</p>
              )}

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-zinc-500">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
