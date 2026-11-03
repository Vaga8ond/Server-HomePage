import { describe, expect, it } from "vitest"
import type { ApiService, ContainerEvent, ContainerInfo, HostMetrics } from "./api"
import { computeHealth, diskPct, serviceFlips, worstUptime } from "./health"

const c = (name: string, state: string): ContainerInfo => ({
  id: name,
  name,
  image: "img",
  state,
  status: "",
  ports: [],
  cpuPercent: null,
  memUsage: null,
  memPercent: null,
})

const s = (name: string, status: ApiService["status"]): ApiService =>
  ({
    id: name,
    name,
    category: "x",
    iconKey: "container",
    color: "#fff",
    port: 80,
    status,
  }) as ApiService

const ev = (action: string, detail: string | null = null): ContainerEvent => ({
  t: 1,
  container: "a",
  action,
  detail,
})

const host = (used: number, total: number): HostMetrics =>
  ({ disk: { used, total } }) as HostMetrics

const empty = {
  containers: [] as ContainerInfo[],
  services: [] as ApiService[],
  uptimePcts: [] as (number | null)[],
  events: [] as ContainerEvent[],
  host: null,
}

describe("computeHealth", () => {
  it("all-green when nothing is provided", () => {
    const r = computeHealth(empty)
    expect(r.ok).toBe(true)
    expect(r.signals.every((x) => x.severity === "ok")).toBe(true)
  })

  it("counts stopped containers as warn", () => {
    const r = computeHealth({
      ...empty,
      containers: [c("a", "running"), c("b", "exited")],
    })
    const sig = r.signals.find((x) => x.id === "containers")!
    expect(sig.count).toBe(1)
    expect(sig.severity).toBe("warn")
    expect(r.ok).toBe(false)
  })

  it("services error is crit, stopped is fine", () => {
    const r = computeHealth({
      ...empty,
      services: [s("a", "running"), s("b", "error"), s("c", "stopped")],
    })
    const sig = r.signals.find((x) => x.id === "services")!
    expect(sig.count).toBe(1)
    expect(sig.severity).toBe("crit")
  })

  it("min 24h uptime <100 warns; null uptime ignored", () => {
    const warn = computeHealth({ ...empty, uptimePcts: [100, 99.2, null] })
    expect(warn.signals.find((x) => x.id === "uptime")!.severity).toBe("warn")
    expect(warn.signals.find((x) => x.id === "uptime")!.label).toContain("99.2")
    const green = computeHealth({ ...empty, uptimePcts: [100, null] })
    expect(green.signals.find((x) => x.id === "uptime")!.severity).toBe("ok")
  })

  it("disk over threshold is crit, under is ok", () => {
    expect(diskPct(host(91, 100))).toBeCloseTo(91)
    const hot = computeHealth({ ...empty, host: host(91, 100) })
    expect(hot.signals.find((x) => x.id === "disk")!.severity).toBe("crit")
    const cool = computeHealth({ ...empty, host: host(50, 100) })
    expect(cool.signals.find((x) => x.id === "disk")!.severity).toBe("ok")
  })

  it("oom/health-unhealthy count as abnormal; die does not", () => {
    const r = computeHealth({
      ...empty,
      events: [ev("die"), ev("oom"), ev("health_status", "unhealthy"), ev("health_status", "healthy")],
    })
    const sig = r.signals.find((x) => x.id === "events")!
    expect(sig.count).toBe(2)
    expect(sig.severity).toBe("crit") // oom present
    const soft = computeHealth({ ...empty, events: [ev("health_status", "unhealthy")] })
    expect(soft.signals.find((x) => x.id === "events")!.severity).toBe("warn")
  })

  it("worstUptime ignores nulls and returns null when no data", () => {
    expect(worstUptime([99, null, 100])).toBe(99)
    expect(worstUptime([null, null])).toBeNull()
    expect(worstUptime([])).toBeNull()
  })

  it("serviceFlips derives down/degraded/recovered transitions", () => {
    const cell = (t: number, ratio: number | null) => ({ t, ratio })
    const flips = serviceFlips("api", [
      cell(1, 1),
      cell(2, 1), // no flip
      cell(3, 0), // down
      cell(4, null), // gap bridged
      cell(5, 1), // recovered (across gap)
      cell(6, 0.5), // degraded
      cell(7, 1), // recovered
      cell(8, null), // trailing gap ignored
    ])
    expect(flips.map((f) => f.action)).toEqual([
      "service-down",
      "service-recovered",
      "service-degraded",
      "service-recovered",
    ])
    expect(flips[0].container).toBe("api")
    expect(flips.every((f) => f.detail === null)).toBe(true)
  })

  it("serviceFlips returns nothing for flat or empty series", () => {
    expect(serviceFlips("x", [])).toEqual([])
    expect(
      serviceFlips("x", [
        { t: 1, ratio: 1 },
        { t: 2, ratio: 1 },
      ]),
    ).toEqual([])
    expect(serviceFlips("x", [{ t: 1, ratio: null }])).toEqual([])
  })
})
