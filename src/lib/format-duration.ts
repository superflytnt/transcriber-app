/**
 * Format milliseconds for display: "11.2s" when under a minute, "3:09" (M:SS) when 1 minute or more.
 */
export function formatDurationMs(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const wholeSec = Math.round(totalSec);
  const m = Math.floor(wholeSec / 60);
  const s = wholeSec % 60;
  return `${m}m:${s.toString().padStart(2, "0")}s`;
}
