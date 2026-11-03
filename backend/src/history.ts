import { db, rowsSince } from "./store"

export type HistoryWindow = "1h" | "6h" | "24h" | "7d"

const SAMPLE_SEC = 15 // recorder interval — converts rate samples into totals

const WINDOW_MS: Record<HistoryWindow, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
}

// Per-window downsample step → ~240–340 buckets for every window.
const STEP_MS: Record<HistoryWindow, number> = {
  "1h": 15_000,
  "6h": 60_000,
  "24h": 300_000,
  "7d": 1_800_000,
}

const KEYS = ["cpu", "mem", "disk", "rx", "tx", "load", "tcp", "temp"] as const
const DAY_MS = 86_400_000
type Key = (typeof KEYS)[number]

export interface HistoryPoint {
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

// SQL bucket averages ignore NULLs — the same "skip null, average the rest"
// behaviour as the previous JSONL reader. The bucket expression truncates
// toward zero via CAST, which equals floor for t >= from.
const bucketAvgStmt = db.prepare(`
  SELECT CAST((t - ?1) / ?2 AS INTEGER) AS bucket,
         AVG(cpu) AS cpu, AVG(mem) AS mem, AVG(disk) AS disk,
         AVG(rx) AS rx, AVG(tx) AS tx,
         AVG(load) AS load, AVG(tcp) AS tcp, AVG(temp) AS temp
  FROM samples
  WHERE t >= ?1
  GROUP BY bucket
`)

/** Downsampled time series for the area chart. */
export function querySeries(window: HistoryWindow) {
  const span = WINDOW_MS[window]
  const step = STEP_MS[window]
  const to = Date.now()
  const from = to - span
  const buckets = Math.ceil(span / step)

  const byBucket = new Map<number, Record<Key, number | null>>()
  for (const row of bucketAvgStmt.all(from, step) as unknown as Array<{ bucket: number } & Record<Key, number | null>>) {
    byBucket.set(Number(row.bucket), {
      cpu: row.cpu, mem: row.mem, disk: row.disk, rx: row.rx,
      tx: row.tx, load: row.load, tcp: row.tcp, temp: row.temp,
    })
  }

  // Scaffold every bucket so empty ones come out null and points[i].t is
  // from + i*step — identical to the pre-SQLite output shape.
  const points = Array.from({ length: buckets }, (_, i) => {
    const point: Record<string, number | null> = { t: from + i * step }
    const a = byBucket.get(i)
    for (const k of KEYS) point[k] = a && a[k] != null ? Number(a[k]) : null
    return point as unknown as HistoryPoint
  })

  return { window, stepMs: step, from, to, points }
}

/** Calendar-day helpers bucket in the container's local time so charts match
 * the user's wall clock (heat/weekly = "evening peak" must look like evening).
 * TZ comes from compose (default Asia/Shanghai, overridable per deployment). */
function dayStartOf(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Last 7 calendar days: per-day traffic totals + 7×24 hourly heatmap cells. */
export function queryAggregate() {
  const todayStart = dayStartOf(Date.now())
  const from = todayStart + DAY_MS - 7 * DAY_MS

  const weekly = Array.from({ length: 7 }, () => ({
    rx: 0,
    tx: 0,
    rxN: 0,
    txN: 0,
    cpuS: 0,
    cpuN: 0,
  }))
  const heat = Array.from({ length: 7 * 24 }, () => ({ s: 0, n: 0 }))

  // Calendar-day grouping stays in JS on purpose: day boundaries follow the
  // container TZ, which SQLite has no notion of. 7d ≈ 40k rows, <10ms.
  for (const p of rowsSince(from)) {
    const idx = 6 - Math.round((todayStart - dayStartOf(p.t)) / DAY_MS)
    if (idx < 0 || idx > 6) continue
    const w = weekly[idx]
    if (p.rx != null) {
      w.rx += p.rx
      w.rxN++
    }
    if (p.tx != null) {
      w.tx += p.tx
      w.txN++
    }
    if (p.cpu != null) {
      w.cpuS += p.cpu
      w.cpuN++
    }
    const cell = heat[idx * 24 + new Date(p.t).getHours()]
    if (p.rx != null || p.tx != null) {
      cell.s += ((p.rx ?? 0) + (p.tx ?? 0)) / 1e6
      cell.n++
    }
  }

  return {
    weekly: weekly.map((w) => ({
      rxGB: (w.rx * SAMPLE_SEC) / 1e9,
      txGB: (w.tx * SAMPLE_SEC) / 1e9,
      cpuAvg: w.cpuN > 0 ? w.cpuS / w.cpuN : null,
    })),
    heatmap: heat.map((h) => (h.n > 0 ? h.s / h.n : null)),
    maxMbps: heat.reduce<number>((m, h) => (h.n > 0 && h.s / h.n > m ? h.s / h.n : m), 0),
  }
}
