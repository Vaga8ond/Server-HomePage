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

describe("custom range", () => {
  it("derives a ~300-bucket step snapped to the 15s grid", () => {
    // 10h → 36_000s/300 = 120s exactly, already a 15s multiple
    const r = history.resolveCustomRange(now - 10 * 3_600_000, now)
    expect(r).not.toBeNull()
    expect(r!.step).toBe(120_000)
    // short spans floor at one sample
    expect(history.resolveCustomRange(now - 3_600_000, now)!.step).toBe(15_000)
    expect(history.resolveCustomRange(now - 2 * 3_600_000, now)!.step).toBe(30_000)
  })

  it("rejects non-finite or empty ranges", () => {
    expect(history.resolveCustomRange(NaN, now)).toBeNull()
    expect(history.resolveCustomRange(now, now)).toBeNull()
    expect(history.resolveCustomRange(now, now - 1)).toBeNull()
  })

  it("clamps to now and the 30d retention horizon", () => {
    const future = history.resolveCustomRange(now - 3_600_000, now + 86_400_000)!
    expect(future.to).toBeLessThanOrEqual(Date.now())
    const old = history.resolveCustomRange(now - 60 * 86_400_000, now)!
    expect(old.to - old.from).toBeLessThanOrEqual(30 * 86_400_000 + 1)
    // 30d / 300 = 8_640s, already on the 15s grid
    expect(old.step).toBe(8_640_000)
  })

  it("querySeries(custom) covers exactly [from, to)", () => {
    // from nudged past the 2h-old fixture sample (cpu 999) — recent two only
    const from = now - 2 * 3_600_000 + 60_000
    const to = now
    const s = history.querySeries("custom", { from, to })
    expect(s.window).toBe("custom")
    expect(s.points.length).toBe(Math.ceil((to - from) / s.stepMs))
    expect(s.points[0].t).toBe(s.from)
    const last = s.points[s.points.length - 1]
    expect(last.t + s.stepMs).toBeLessThanOrEqual(to)
    const withData = s.points.filter((x) => x.cpu != null)
    expect(withData.map((x) => x.cpu).sort((a, b) => a! - b!)).toEqual([10, 30])
  })

  it("querySeries(custom) without a usable range throws", () => {
    expect(() => history.querySeries("custom")).toThrow(RangeError)
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
