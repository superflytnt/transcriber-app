import { readFileSync, existsSync, copyFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runTranscriptionJob } from "../src/lib/run-transcription";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
}
const uploadDir = process.env.UPLOAD_DIR ?? "/tmp/transcriber-uploads";
mkdirSync(uploadDir, { recursive: true });
const qtaPath = join(root, "..", "samples", "7833 Whiterim Terr.qta");
const testPath = join(uploadDir, `test-${Date.now()}-7833_Whiterim_Terr.qta`);
copyFileSync(qtaPath, testPath);

const result = await runTranscriptionJob({
  filePath: testPath,
  originalFileName: "7833 Whiterim Terr.qta",
  mimeType: "audio/mpeg",
  uploadStartedAt: Date.now() - 100,
  uploadFinishedAt: Date.now(),
});
console.log("OK", result.text?.slice(0, 150));
