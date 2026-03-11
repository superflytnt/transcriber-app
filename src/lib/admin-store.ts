import { env } from "./env";

const USER_EMAILS_KEY = "transcriber:user_emails";
const ADMINS_KEY = "transcriber:admins";

const FIRST_ADMIN_EMAIL = (process.env.FIRST_ADMIN_EMAIL ?? "seth@seth.org").trim().toLowerCase();

async function getRedis(): Promise<import("ioredis").default | null> {
  if (!env.redisUrl) return null;
  try {
    const Redis = (await import("ioredis")).default;
    return new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  } catch {
    return null;
  }
}

const memoryUserEmails = new Set<string>();
const memoryAdmins = new Set<string>();

export async function addUser(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const r = await getRedis();
  if (r) {
    await r.sadd(USER_EMAILS_KEY, normalized);
  } else {
    memoryUserEmails.add(normalized);
  }
}

export async function setAdmin(email: string, isAdmin: boolean): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const r = await getRedis();
  if (r) {
    if (isAdmin) await r.sadd(ADMINS_KEY, normalized);
    else await r.srem(ADMINS_KEY, normalized);
  } else {
    if (isAdmin) memoryAdmins.add(normalized);
    else memoryAdmins.delete(normalized);
  }
}

/** Remove user from the list (and admin set). They can reappear if they sign in again. */
export async function removeUser(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const r = await getRedis();
  if (r) {
    await r.srem(USER_EMAILS_KEY, normalized);
    await r.srem(ADMINS_KEY, normalized);
  } else {
    memoryUserEmails.delete(normalized);
    memoryAdmins.delete(normalized);
  }
}

/** Number of admins (for safety: don't delete last admin). */
export async function countAdmins(): Promise<number> {
  const r = await getRedis();
  if (r) return await r.scard(ADMINS_KEY);
  return memoryAdmins.size;
}

export async function isAdmin(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  await ensureFirstAdmin();
  const r = await getRedis();
  if (r) {
    return (await r.sismember(ADMINS_KEY, normalized)) === 1;
  }
  return memoryAdmins.has(normalized);
}

export type ListUsersResult = { users: { email: string; isAdmin: boolean }[]; total: number };

export async function listUsers(options: {
  offset: number;
  limit: number;
  search?: string;
}): Promise<ListUsersResult> {
  await ensureFirstAdmin();
  const { offset, limit, search = "" } = options;
  const searchLower = search.trim().toLowerCase();
  const r = await getRedis();
  let emails: string[];
  let adminSet: Set<string>;
  if (r) {
    emails = await r.smembers(USER_EMAILS_KEY);
    const adminList = await r.smembers(ADMINS_KEY);
    adminSet = new Set(adminList);
  } else {
    emails = Array.from(memoryUserEmails);
    adminSet = new Set(memoryAdmins);
  }
  emails = Array.from(new Set(emails)).sort((a, b) => a.localeCompare(b));
  if (searchLower) {
    emails = emails.filter((e) => e.includes(searchLower));
  }
  const total = emails.length;
  const page = emails.slice(offset, offset + limit);
  const users = page.map((email) => ({ email, isAdmin: adminSet.has(email) }));
  return { users, total };
}

/** Ensure at least one admin exists (e.g. first deploy). Idempotent. */
export async function ensureFirstAdmin(): Promise<void> {
  const r = await getRedis();
  if (r) {
    const n = await r.scard(ADMINS_KEY);
    if (n === 0) {
      await r.sadd(ADMINS_KEY, FIRST_ADMIN_EMAIL);
      await r.sadd(USER_EMAILS_KEY, FIRST_ADMIN_EMAIL);
    }
  } else {
    if (memoryAdmins.size === 0) memoryAdmins.add(FIRST_ADMIN_EMAIL);
    if (!memoryUserEmails.has(FIRST_ADMIN_EMAIL)) memoryUserEmails.add(FIRST_ADMIN_EMAIL);
  }
}
