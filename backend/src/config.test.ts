import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** config.ts reads SERVICES_CONFIG at module load — fresh import per test. */
async function loadWith(servicesJson: string) {
  const dir = mkdtempSync(join(tmpdir(), "hb-config-"))
  const file = join(dir, "services.json")
  writeFileSync(file, servicesJson)
  vi.resetModules()
  process.env.SERVICES_CONFIG = file
  return import("./config")
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.SERVICES_CONFIG
})

describe("readServices", () => {
  it("parses a valid catalog", async () => {
    const config = await loadWith(
      '{"services":[{"id":"a","name":"A","category":"X","iconKey":"box","color":"#fff","port":80}]}',
    )
    expect(config.readServices()).toHaveLength(1)
    expect(config.readServices()[0].port).toBe(80)
  })

  it("drops malformed entries, keeps valid ones", async () => {
    const config = await loadWith(
      '{"services":[{"id":"ok","name":"OK","category":"X","iconKey":"box","color":"#fff","port":1},"garbage",{"name":"no-port"}]}',
    )
    const services = config.readServices()
    expect(services).toHaveLength(1)
    expect(services[0].id).toBe("ok")
  })

  it("falls back to last good catalog on broken JSON", async () => {
    const good = '{"services":[{"id":"g","name":"G","category":"X","iconKey":"box","color":"#fff","port":2}]}'
    const config = await loadWith(good)
    expect(config.readServices()).toHaveLength(1)

    // same module instance keeps lastGood — break the file, re-read
    const { writeFileSync } = await import("node:fs")
    writeFileSync(process.env.SERVICES_CONFIG!, "{broken")
    expect(config.readServices()).toHaveLength(1)
    expect(config.readServices()[0].id).toBe("g")
  })

  it("returns empty list when file missing and no history", async () => {
    vi.resetModules()
    process.env.SERVICES_CONFIG = join(tmpdir(), "does-not-exist.json")
    const config = await import("./config")
    expect(config.readServices()).toEqual([])
  })
})

describe("probeUrl", () => {
  it("prefers explicit url override", async () => {
    const config = await loadWith('{"services":[]}')
    expect(
      config.probeUrl({
        id: "x", name: "X", category: "C", iconKey: "i", color: "#000",
        port: 8080, url: "https://example.com:9443/health",
      }),
    ).toBe("https://example.com:9443/health")
  })

  it("derives scheme://host:port otherwise", async () => {
    delete process.env.PROBE_HOST
    const config = await loadWith('{"services":[]}')
    expect(
      config.probeUrl({
        id: "x", name: "X", category: "C", iconKey: "i", color: "#000", port: 3000,
      }),
    ).toBe("http://host.docker.internal:3000")
    expect(
      config.probeUrl({
        id: "y", name: "Y", category: "C", iconKey: "i", color: "#000",
        port: 443, scheme: "https",
      }),
    ).toBe("https://host.docker.internal:443")
  })
})
