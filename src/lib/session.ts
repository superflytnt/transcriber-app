import crypto from "node:crypto";
import { env } from "./env";

const COOKIE_NAME = "transcriber_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export function signSession(email: string): string {
  const secret = env.sessionSecret || "dev-secret-change-in-production";
  const payload = JSON.stringify({ email: email.trim().toLowerCase(), exp: Date.now() + MAX_AGE_SEC * 1000 });
  const b64 = Buffer.from(payload, "utf-8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifySession(cookieValue: string | null | undefined): string | null {
  if (!cookieValue?.trim()) return null;
  const secret = env.sessionSecret || "dev-secret-change-in-production";
  const parts = cookieValue.trim().split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  if (sig !== expectedSig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  let data: { email: string; exp: number };
  try {
    data = JSON.parse(payload) as { email: string; exp: number };
  } catch {
    return null;
  }
  if (Date.now() > data.exp) return null;
  return data.email ?? null;
}

export function getSessionFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;)\\s*${COOKIE_NAME}=([^;]*)`));
  return verifySession(match?.[1]?.trim() ?? null);
}

export function sessionCookieHeader(value: string, maxAgeSec: number = MAX_AGE_SEC): string {
  const sameSite = "Lax";
  const path = "/";
  const httpOnly = true;
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSec}`,
    `SameSite=${sameSite}`,
    ...(httpOnly ? ["HttpOnly"] : []),
    ...(secure ? ["Secure"] : []),
  ];
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}

export { COOKIE_NAME };
