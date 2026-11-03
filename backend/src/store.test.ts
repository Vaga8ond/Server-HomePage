import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** DATA_DIR is read at module load — fixture precedes the import. */
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "hb-store-"))

const store = await import("./store")

const base = { cpu: null, mem: null, disk: null, rx: null, tx: null, load: null, tcp: null, temp: null }

describe("store", () => {
  it("round-trips samples and orders by t", () => {
    store.insertSample({ t: 1_000, ...base, cpu: 5 })
    store.insertSample({ t: 2_000, ...base, cpu: 7 })
    const rows = store.rowsSince(0)
    expect(rows).toHaveLength(2)
    expect(rows[0].t).toBe(1_000)
    expect(rows[1].cpu).toBe(7)
  })

  it("prunes below cutoff and counts what remains", () => {
    expect(store.sampleCount()).toBe(2)
    store.deleteSamplesBefore(1_500)
    expect(store.sampleCount()).toBe(1)
    expect(store.rowsSince(0)[0].t).toBe(2_000)
    store.checkpoint() // must not throw
  })

  it("stores nulls for absent metrics", () => {
    store.insertSample({ t: 3_000, ...base })
    const row = store.rowsSince(2_500)[0]
    expect(row.cpu).toBeNull()
    expect(row.temp).toBeNull()
  })
})
