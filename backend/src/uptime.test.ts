import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** DATA_DIR/store are read at module load — fixtures precede the imports. */
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "hb-uptime-"))

const store = await import("./store")
const now = Date.now()
const t = now - 60_000

// Two probes at the SAME t → same bucket regardless of bucket boundaries.
store.insertProbe(t, "a", "running", 100)
store.insertProbe(t, "a", "running", 200)
// error probe 3h earlier → its own cell (3h ≫ 15min step), no latency
store.insertProbe(now - 3 * 3_600_000, "a", "error", null)
store.insertProbe(t, "b", "stopped", null)

const uptime = await import("./uptime")

describe("queryUptime", () => {
  it("buckets probes per service with ratio and latency", () => {
    const q = uptime.queryUptime("24h")
    expect(q.stepMs).toBe(900_000)
    expect(q.services.map((s: { name: string }) => s.name)).toEqual(["a", "b"])

    const a = q.services[0]
    expect(a.cells).toHaveLength(96)
    const upCells = a.cells.filter((c: { ratio: number | null }) => c.ratio === 1)
    expect(upCells).toHaveLength(1)
    expect(upCells[0].latencyMs).toBe(150) // AVG(100, 200)
    expect(a.cells.filter((c: { ratio: number | null }) => c.ratio === 0)).toHaveLength(1)
    expect(a.cells.filter((c: { ratio: number | null }) => c.ratio === null)).toHaveLength(94)
    // 2 of 3 probes answered
    expect(a.uptimePct).toBeCloseTo((2 / 3) * 100, 6)
  })

  it("reports stopped-only services and supports the 7d window", () => {
    const q = uptime.queryUptime("24h")
    const b = q.services[1]
    expect(b.uptimePct).toBe(0)
    expect(b.cells.filter((c: { ratio: number | null }) => c.ratio === 0)).toHaveLength(1)

    const week = uptime.queryUptime("7d")
    expect(week.stepMs).toBe(7_200_000)
    expect(week.services[0].cells).toHaveLength(84)
  })
})
