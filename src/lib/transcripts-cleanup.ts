import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

let legacyCleaned = false;

/**
 * One-time cleanup: delete any existing transcripts in the root save dir (legacy flat layout).
 * After this, transcripts only live in per-user subdirs.
 */
export async function deleteLegacyTranscriptsOnce(): Promise<void> {
  if (legacyCleaned) return;
  legacyCleaned = true;
  const baseDir = env.transcriptSaveBaseDir;
  try {
    const entries = (await fs.readdir(baseDir, { withFileTypes: true })) as Dirent[];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name.endsWith(".json") || e.name.endsWith(".txt")) {
        await fs.unlink(path.join(baseDir, e.name)).catch(() => undefined);
      }
    }
  } catch {
    // dir may not exist or be unreadable
  }
}
