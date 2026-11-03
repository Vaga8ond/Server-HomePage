import { mkdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Single owner of the SQLite history store (recorder writes, history reads).
 *
 * Availability: `node:sqlite` is stable from Node 23.4; on Node 22.5–22.x it
 * needs `--experimental-sqlite` (the Dockerfile CMD sets it). Anything older
 * fails here with this error instead of a cryptic builtin-module error.
 */
let DatabaseSync: typeof import("node:sqlite").DatabaseSync
try {
  ;({ DatabaseSync } = await import("node:sqlite"))
} catch {
  throw new Error(
    "node:sqlite unavailable — Node >= 22.5 needs --experimental-sqlite (Dockerfile CMD sets it); Node >= 23.4 needs no flag",
  )
}

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data")
const DB_PATH = join(DATA_DIR, "homebase.db")

export interface SampleRow {
  t: number
  cpu: number | null
  mem: number | null
  disk: number | null
  rx: number | null
  tx: number | null
  load: number | null
  tcp: number | null
  temp: number | null
}

mkdirSync(DATA_DIR, { recursive: true })
export const db = new DatabaseSync(DB_PATH)

// WAL + NORMAL: fast single-writer appends; the -wal file is kept tiny by the
// post-prune checkpoint so plain file copies of DATA_DIR stay consistent.
db.exec("PRAGMA journal_mode = WAL")
db.exec("PRAGMA synchronous = NORMAL")

db.exec(`
  CREATE TABLE IF NOT EXISTS samples (
    t    INTEGER NOT NULL,            -- epoch ms
    cpu  REAL, mem REAL, disk REAL,
    rx   REAL, tx REAL,               -- bytes/sec
    load REAL, tcp INTEGER, temp REAL
  )
`)
// Plain indexed column, not a PRIMARY KEY: a same-ms collision (fast restart)
// must not silently drop a row via INSERT OR REPLACE semantics.
db.exec("CREATE INDEX IF NOT EXISTS idx_samples_t ON samples(t)")
db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")

// Service probe history (uptime bars). One row per real probe of a service.
db.exec(`
  CREATE TABLE IF NOT EXISTS probes (
    t         INTEGER NOT NULL,        -- epoch ms
    name      TEXT NOT NULL,           -- service name (catalog key)
    status    TEXT NOT NULL,           -- running | stopped | error
    latencyMs INTEGER                  -- null when service did not answer
  )
`)
db.exec("CREATE INDEX IF NOT EXISTS idx_probes_name_t ON probes(name, t)")

// Container lifecycle events (docker-events stream → overview timeline).
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    t         INTEGER NOT NULL,        -- epoch ms
    container TEXT NOT NULL,
    action    TEXT NOT NULL,           -- start | die | oom | health_status
    detail    TEXT                     -- e.g. "health_status: healthy"
  )
`)
db.exec("CREATE INDEX IF NOT EXISTS idx_events_t ON events(t)")

const insertStmt = db.prepare(
  `INSERT INTO samples (t, cpu, mem, disk, rx, tx, load, tcp, temp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM samples")
const deleteBeforeStmt = db.prepare("DELETE FROM samples WHERE t < ?")
const rowsSinceStmt = db.prepare("SELECT * FROM samples WHERE t >= ? ORDER BY t")
const insertProbeStmt = db.prepare(
  "INSERT INTO probes (t, name, status, latencyMs) VALUES (?, ?, ?, ?)",
)
const deleteProbesBeforeStmt = db.prepare("DELETE FROM probes WHERE t < ?")
const insertEventStmt = db.prepare(
  "INSERT INTO events (t, container, action, detail) VALUES (?, ?, ?, ?)",
)
const recentEventsStmt = db.prepare(
  "SELECT t, container, action, detail FROM events WHERE t >= ? ORDER BY t DESC LIMIT 500",
)
const deleteEventsBeforeStmt = db.prepare("DELETE FROM events WHERE t < ?")

export interface EventRow {
  t: number
  container: string
  action: string
  detail: string | null
}

export function insertSample(r: SampleRow): void {
  insertStmt.run(r.t, r.cpu, r.mem, r.disk, r.rx, r.tx, r.load, r.tcp, r.temp)
}

export function sampleCount(): number {
  return Number(countStmt.get()?.n ?? 0)
}

export function deleteSamplesBefore(cutoffMs: number): void {
  deleteBeforeStmt.run(cutoffMs)
}

export function checkpoint(): void {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
}

/** All recorded samples with t >= fromMs, oldest first. */
export function rowsSince(fromMs: number): SampleRow[] {
  return rowsSinceStmt.all(fromMs) as unknown as SampleRow[]
}

export function insertProbe(
  t: number,
  name: string,
  status: string,
  latencyMs: number | null,
): void {
  insertProbeStmt.run(t, name, status, latencyMs)
}

export function deleteProbesBefore(cutoffMs: number): void {
  deleteProbesBeforeStmt.run(cutoffMs)
}

export function insertEvent(
  t: number,
  container: string,
  action: string,
  detail: string | null,
): void {
  insertEventStmt.run(t, container, action, detail)
}

/** Newest-first container events since fromMs (capped — timeline only). */
export function recentEvents(fromMs: number): EventRow[] {
  return recentEventsStmt.all(fromMs) as unknown as EventRow[]
}

export function deleteEventsBefore(cutoffMs: number): void {
  deleteEventsBeforeStmt.run(cutoffMs)
}
