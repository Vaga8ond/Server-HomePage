import http from "node:http"
import https from "node:https"

import type {
  ServiceConfig,
  ServiceStatus,
  ServiceStatusResult,
} from "./types"
import { readServices } from "./config"
import { discoverServices } from "./docker"
import { probeUrl } from "./config"
import { insertProbe } from "./store"

const CACHE_MS = 5000
const TIMEOUT_MS = 3000

interface Cache {
  ts: number
  data: ServiceStatusResult[]
}
let cache: Cache | null = null

function probe(url: string): Promise<{
  status: ServiceStatus
  latencyMs: number | null
}> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolve({ status: "error", latencyMs: null })
      return
    }
    const lib = target.protocol === "https:" ? https : http
    const start = Date.now()
    // Intentional: homelab services often use self-signed certs; we only
    // care about "did it answer", not who signed it. Keep LAN-only URLs here.
    const req = lib.get(
      url,
      { timeout: TIMEOUT_MS, rejectUnauthorized: false },
      (res) => {
        res.destroy()
        resolve({ status: "running", latencyMs: Date.now() - start })
      },
    )
    req.on("error", (err: NodeJS.ErrnoException) => {
      resolve({
        status: err.code === "ECONNREFUSED" ? "stopped" : "error",
        latencyMs: null,
      })
    })
    req.on("timeout", () => {
      req.destroy()
      resolve({ status: "error", latencyMs: null })
    })
  })
}

let lastWarn = 0

/** Best-effort history write of fresh probe results (uptime bars).
 *  probe:false entries have no HTTP surface — their status is derived from
 *  the container state elsewhere, so they never enter probe history. */
function recordProbes(results: ServiceStatusResult[], t: number): void {
  try {
    for (const r of results) {
      if (r.probe === false) continue
      insertProbe(t, r.name, r.status, r.latencyMs)
    }
  } catch {
    // Best-effort: warn at most once a minute and keep serving live status.
    if (Date.now() - lastWarn > 60_000) {
      lastWarn = Date.now()
      console.warn("probe: cannot record history")
    }
  }
}

export async function probeAll(
  services: ServiceConfig[],
): Promise<ServiceStatusResult[]> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.data
  const t = Date.now()
  const results = await Promise.all(
    services.map(async (service) => {
      if (service.probe === false) {
        // No HTTP surface — the real status is derived from the mapped
        // container state in index.ts; this placeholder is never shown.
        return {
          ...service,
          status: "running" as ServiceStatus,
          latencyMs: null,
          checkedAt: t,
        }
      }
      const result = await probe(probeUrl(service))
      return {
        ...service,
        status: result.status,
        latencyMs: result.latencyMs,
        checkedAt: t,
      }
    }),
  )
  cache = { ts: t, data: results }
  recordProbes(results, t)
  return results
}

let proberStarted = false
let proberLastWarn = 0

/** Full service catalog, same assembly as GET /api/services. */
async function currentCatalog(): Promise<ServiceConfig[]> {
  const manual = readServices()
  return [...manual, ...(await discoverServices(manual))]
}

/** Background prober: probe the whole catalog every interval and record
 *  history, regardless of whether anyone is watching the dashboard. Without
 *  this, uptime bars only fill while a browser holds /api/services open —
 *  overnight gaps read as "unmonitored" instead of "up". Best-effort: a
 *  failed round warns (throttled) and tries again next tick. */
export function startProber(intervalMs = 60_000): void {
  if (proberStarted) return
  proberStarted = true
  const tick = async () => {
    try {
      await probeAll(await currentCatalog())
    } catch {
      if (Date.now() - proberLastWarn > 60_000) {
        proberLastWarn = Date.now()
        console.warn("prober: round failed, retrying next interval")
      }
    }
  }
  void tick()
  setInterval(tick, intervalMs).unref?.()
}
