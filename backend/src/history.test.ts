import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { SampleRow } from "./store"

/** DATA_DIR/store are read at module load — fixtures precede the imports. */
const dataDir = mkdtempSync(join(tmpdir(), "hb-hist-"))
process.env.DATA_DIR = dataDir

const store = await import("./store")
const now = Date.now()
const row = (t: number, fields: Partial<SampleRow>): SampleRow => ({
  t,
  cpu: null,
  mem: null,
  disk: null,
  rx: null,
  tx: null,
  load: null,
  tcp: null,
  temp: null,
  ...fields,
})

store.insertSample(row(now - 60_000, { cpu: 10, rx: 100, tx: 200 })) // inside 1h window
store.insertSample(row(now - 30_000, { cpu: 30, rx: 300, tx: 400 }))
store.insertSample(row(now - 2 * 3600_000, { cpu: 999 })) // outside 1h, inside 7d (aggregate)

const history = await import("./history")

describe("querySeries", () => {
  it("averages samples per bucket and leaves empty buckets null", () => {
    const series = history.querySeries("1h")
    expect(series.window).toBe("1h")
    expect(series.points.length).toBe(Math.ceil(3_600_000 / series.stepMs))
    const withData = series.points.filter((x) => x.cpu != null)
    expect(withData).toHaveLength(2)
    // two samples, each alone in its 15s bucket → bucket value == sample value
    expect(withData.map((x) => x.cpu).sort((a, b) => a! - b!)).toEqual([10, 30])
    expect(withData.every((x) => x.temp === null)).toBe(true)
    // metrics never recorded stay null — SQL AVG over all-NULL column is NULL
    expect(withData.every((x) => x.mem === null)).toBe(true)
    expect(series.points[0].t).toBe(series.from)
  })
})

describe("queryAggregate", () => {
  it("converts rate samples to per-day GB totals via SAMPLE_SEC", () => {
    const agg = history.queryAggregate()
    const today = agg.weekly[6]
    // rx rate samples 100+300 B/s, each held 15s → 400×15 = 6000 B
    expect(today.rxGB).toBeCloseTo((400 * 15) / 1e9, 12)
    // cpu samples include the 2h-old point (999) — aggregate window is 7d
    expect(today.cpuAvg).toBeCloseTo(1039 / 3, 6)
    // empty days → null cpu, zero traffic
    expect(agg.weekly[0].rxGB).toBe(0)
    expect(agg.weekly[0].cpuAvg).toBeNull()
    expect(agg.maxMbps).toBeGreaterThanOrEqual(0)
  })
})
