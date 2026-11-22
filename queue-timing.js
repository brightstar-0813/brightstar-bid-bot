/**
 * Per-queue-job duration tracking for batch / generate runs.
 * startedAt is stamped when status becomes running; durationMs when it leaves running.
 */

export function applyQueueJobTiming(prev = {}, patch = {}, now = Date.now()) {
  const merged = { ...prev, ...patch };
  const prevStatus = String(prev?.status || "");
  const nextStatus = String(merged.status || prevStatus);
  const statusChanging = Object.prototype.hasOwnProperty.call(patch, "status");

  if (statusChanging && nextStatus === "running" && prevStatus !== "running") {
    if (patch.startedAt == null) merged.startedAt = now;
    if (patch.finishedAt === undefined) merged.finishedAt = 0;
    if (patch.durationMs === undefined) merged.durationMs = 0;
    return merged;
  }

  if (statusChanging && prevStatus === "running" && nextStatus !== "running") {
    const started = Number(prev.startedAt || merged.startedAt || 0);
    if (started > 0) {
      if (patch.finishedAt === undefined) merged.finishedAt = now;
      if (patch.durationMs === undefined) {
        const end = Number(merged.finishedAt || now);
        merged.durationMs = Math.max(0, end - started);
      }
    }
  }

  return merged;
}

/** Elapsed ms to show for a job (live while running, frozen after). */
export function resolveQueueDurationMs(job, now = Date.now()) {
  if (!job) return 0;
  if (String(job.status || "") === "running") {
    const started = Number(job.startedAt || 0);
    return started > 0 ? Math.max(0, now - started) : 0;
  }
  const stored = Number(job.durationMs || 0);
  if (stored > 0) return stored;
  const started = Number(job.startedAt || 0);
  const finished = Number(job.finishedAt || 0);
  if (started > 0 && finished >= started) return finished - started;
  return 0;
}

/** Compact clock label: 42s · 2m 42s · 1h 05m */
export function formatQueueDuration(ms) {
  const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${seconds}s`;
}
