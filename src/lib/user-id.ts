import path from "node:path";
import crypto from "node:crypto";
import { env } from "./env";

/**
 * Stable, URL-safe id for a user (used as transcript subdir name).
 * Same email always yields the same id.
 */
export function getUserId(email: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function getTranscriptSaveDirForUser(userId: string): string {
  return path.join(env.transcriptSaveBaseDir, userId);
}
