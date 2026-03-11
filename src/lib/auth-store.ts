import crypto from "node:crypto";
import { env } from "./env";

const LOGIN_TTL_SEC = 60 * 15; // 15 minutes
const RATE_LIMIT_WINDOW_SEC = 60 * 5;
const RATE_LIMIT_MAX_PER_EMAIL = 10;

type StoredLogin = { email: string; expiresAt: number };

const memoryStore = new Map<string, { value: string; expiresAt: number }>();
const rateLimitCount = new Map<string, number[]>();

async function getRedisClient(): Promise<import("ioredis").default | null> {
  if (!env.redisUrl) return null;
  try {
    const Redis = (await import("ioredis")).default;
    return new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  } catch {
    return null;
  }
}

let redisClient: import("ioredis").default | null = null;
async function getRedis(): Promise<import("ioredis").default | null> {
  if (redisClient) return redisClient;
  redisClient = await getRedisClient();
  return redisClient;
}

async function redisSet(key: string, value: string, ttlSec: number): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  await r.setex(key, ttlSec, value);
}

async function redisGet(key: string): Promise<string | null> {
  const r = await getRedis();
  if (!r) return null;
  return r.get(key);
}

async function redisDel(key: string): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  await r.del(key);
}

function memorySet(key: string, value: string, ttlSec: number): void {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

function memoryGet(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memoryDel(key: string): void {
  memoryStore.delete(key);
}

async function storeSet(key: string, value: string, ttlSec: number): Promise<void> {
  const r = await getRedis();
  if (r) await redisSet(key, value, ttlSec);
  else if (env.redisUrl) throw new Error("Redis unavailable");
  else memorySet(key, value, ttlSec);
}

async function storeGet(key: string): Promise<string | null> {
  const r = await getRedis();
  if (r) return redisGet(key);
  if (env.redisUrl) throw new Error("Redis unavailable");
  return memoryGet(key);
}

async function storeDel(key: string): Promise<void> {
  const r = await getRedis();
  if (r) await redisDel(key);
  else if (env.redisUrl) throw new Error("Redis unavailable");
  else memoryDel(key);
}

async function checkRateLimit(email: string): Promise<boolean> {
  const key = `ratelimit:${email.toLowerCase()}`;
  const r = await getRedis();
  if (r) {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, RATE_LIMIT_WINDOW_SEC);
    return count <= RATE_LIMIT_MAX_PER_EMAIL;
  }
  const now = Date.now();
  let times = rateLimitCount.get(key) ?? [];
  times = times.filter((t) => now - t < RATE_LIMIT_WINDOW_SEC * 1000);
  if (times.length >= RATE_LIMIT_MAX_PER_EMAIL) return false;
  times.push(now);
  rateLimitCount.set(key, times);
  return true;
}

export async function createLoginToken(email: string): Promise<{ token: string; code: string } | { error: "rate_limit" }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Email required");
  if (!(await checkRateLimit(normalized))) return { error: "rate_limit" };

  const token = crypto.randomBytes(32).toString("hex");
  const code = String(crypto.randomInt(100_000, 999_999));
  const payload: StoredLogin = { email: normalized, expiresAt: Date.now() + LOGIN_TTL_SEC * 1000 };
  const payloadStr = JSON.stringify(payload);

  await storeSet(`login:token:${token}`, payloadStr, LOGIN_TTL_SEC);
  await storeSet(`login:code:${code}`, payloadStr, LOGIN_TTL_SEC);

  return { token, code };
}

export async function verifyToken(token: string): Promise<string | null> {
  const raw = await storeGet(`login:token:${token}`);
  if (!raw) return null;
  await storeDel(`login:token:${token}`);
  let data: StoredLogin;
  try {
    data = JSON.parse(raw) as StoredLogin;
  } catch {
    return null;
  }
  if (Date.now() > data.expiresAt) return null;
  return data.email;
}

export async function verifyCode(code: string): Promise<string | null> {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const raw = await storeGet(`login:code:${normalized}`);
  if (!raw) return null;
  await storeDel(`login:code:${normalized}`);
  let data: StoredLogin;
  try {
    data = JSON.parse(raw) as StoredLogin;
  } catch {
    return null;
  }
  if (Date.now() > data.expiresAt) return null;
  return data.email;
}
