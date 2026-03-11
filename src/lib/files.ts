import fs from "node:fs/promises";
import path from "node:path";

export const ensureDirectory = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const safeUploadPath = (baseDir: string, fileName: string): string => {
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(baseDir, `${Date.now()}-${sanitizedName}`);
};

export const bytesToMb = (bytes: number): number => {
  return bytes / (1024 * 1024);
};

/** Sanitize for use in a filename (no path, no unsafe chars). */
export const safeTranscriptBasename = (originalFileName: string): string => {
  const base = originalFileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(0, 80) || "transcript";
};
