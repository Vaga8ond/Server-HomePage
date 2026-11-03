import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** DATA_DIR/store are read at module load — fixtures precede the imports. */
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "hb-events-"))

const store = await import("./store")
const { recordDockerEvent } = await import("./docker-events")

recordDockerEvent({ time: 1000, Action: "start", Actor: { Attributes: { name: "web" } } })
recordDockerEvent({
  time: 2000,
  Action: "health_status: healthy",
  Actor: { Attributes: { name: "web" } },
})
recordDockerEvent({ time: 3000, Action: "pull", Actor: { Attributes: { name: "web" } } }) // filtered
recordDockerEvent({ time: 4000, Action: "die" }) // no container name → skipped
recordDockerEvent({ Action: "start", Actor: { Attributes: { name: "api" } } }) // no time → now

describe("docker event recording", () => {
  it("keeps only whitelisted actions with a container name, newest first", () => {
    const rows = store.recentEvents(0)
    expect(rows).toHaveLength(3)
    expect(rows[0].container).toBe("api") // now > 2000 → newest first
    expect(rows.map((r) => r.action).sort()).toEqual(["health_status", "start", "start"])
    const h = rows.find((r) => r.action === "health_status")
    expect(h?.detail).toBe("health_status: healthy")
    expect(rows.every((r) => r.action !== "pull")).toBe(true)
  })

  it("respects the since cutoff", () => {
    expect(store.recentEvents(Date.now())).toHaveLength(0)
    // fixture ts 1000/2000 are 1970 epoch-ms — only the now-fallback event passes
    expect(store.recentEvents(Date.now() - 5000)).toHaveLength(1)
  })
})
