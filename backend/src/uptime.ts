import { db } from "./store"

export type UptimeWindow = "24h" | "7d"

const WINDOW_MS: Record<UptimeWindow, number> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
}

// Cell counts keep each bar small enough to read at card width:
// 24h → 15-minute cells, 7d → 2-hour cells.
const BUCKETS: Record<UptimeWindow, number> = {
  "24h": 96,
  "7d": 84,
}

export interface UptimeCell {
  t: number
  /** running / total probes in the cell; null = no probes (unknown). */
  ratio: number | null
  /** Mean answered latency in the cell (null-latency probes excluded). */
  latencyMs: number | null
}

export interface ServiceUptime {
  name: string
  /** Window-wide uptime percentage (0–100); null if never probed. */
  uptimePct: number | null
  cells: UptimeCell[]
}

// SUM(status='running') → SQLite booleans are 0/1. AVG skips NULL latencies,
// which is exactly the "did not answer" rows.
const bucketStmt = db.prepare(`
  SELECT name,
         CAST((t - ?1) / ?2 AS INTEGER) AS bucket,
         SUM(status = 'running') AS up,
         COUNT(*) AS n,
         AVG(latencyMs) AS latency
  FROM probes
  WHERE t >= ?1
  GROUP BY name, bucket
  ORDER BY name
`)

/** Per-service uptime buckets for the service-card availability bars. */
export function queryUptime(window: UptimeWindow) {
  const span = WINDOW_MS[window]
  const buckets = BUCKETS[window]
  const step = Math.floor(span / buckets)
  const to = Date.now()
  const from = to - span

  const seen = new Map<string, { up: number; n: number; byCell: Map<number, { up: number; n: number; latency: number | null }> }>()
  for (const row of bucketStmt.all(from, step) as unknown as Array<{
    name: string
    bucket: number
    up: number
    n: number
    latency: number | null
  }>) {
    let svc = seen.get(row.name)
    if (!svc) {
      svc = { up: 0, n: 0, byCell: new Map() }
      seen.set(row.name, svc)
    }
    svc.byCell.set(Number(row.bucket), { up: Number(row.up), n: Number(row.n), latency: row.latency })
    svc.up += Number(row.up)
    svc.n += Number(row.n)
  }

  const services: ServiceUptime[] = []
  for (const [name, svc] of seen) {
    const cells: UptimeCell[] = Array.from({ length: buckets }, (_, i) => {
      const c = svc.byCell.get(i)
      return {
        t: from + i * step,
        ratio: c ? c.up / c.n : null,
        latencyMs: c?.latency != null ? Math.round(c.latency) : null,
      }
    })
    services.push({
      name,
      uptimePct: svc.n > 0 ? (svc.up / svc.n) * 100 : null,
      cells,
    })
  }

  return { window, stepMs: step, from, to, services }
}
