import { getSnapshot } from "./metrics"
import { checkpoint, deleteSamplesBefore, insertSample } from "./store"

const SAMPLE_MS = 15_000
const RETENTION_DAYS = 30

let lastWarn = 0

/** Flatten the live snapshot into the sample row. */
function toRow() {
  const s = getSnapshot()
  return {
    t: s.ts,
    cpu: s.cpu?.percent ?? null,
    mem: s.memory?.percent ?? null,
    disk: s.disk?.percent ?? null,
    rx: s.network?.rxBytesPerSec ?? null,
    tx: s.network?.txBytesPerSec ?? null,
    load: s.load?.one ?? null,
    tcp: s.tcpConnections,
    temp: s.temperatureC,
  }
}

function record(): void {
  try {
    insertSample(toRow())
  } catch {
    // Best-effort: warn at most once a minute and keep serving live metrics.
    if (Date.now() - lastWarn > 60_000) {
      lastWarn = Date.now()
      console.warn("recorder: cannot write history sample")
    }
  }
}

function prune(): void {
  try {
    deleteSamplesBefore(Date.now() - RETENTION_DAYS * 86_400_000)
    // Keep the WAL tiny so file-copy backups of DATA_DIR stay consistent.
    checkpoint()
  } catch {
    /* nothing to prune */
  }
}

let started = false

export function startRecorder(): void {
  if (started) return
  started = true
  record()
  setInterval(record, SAMPLE_MS).unref?.()
  prune()
  setInterval(prune, 24 * 3_600_000).unref?.()
}
