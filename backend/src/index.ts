import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"

import { Hono } from "hono"
import { serve } from "@hono/node-server"

import { readServices } from "./config"
import {
  containerLogs,
  containerStateMap,
  controlContainer,
  discoverServices,
  listContainers,
} from "./docker"
import { queryAggregate, querySeries, type HistoryWindow } from "./history"
import { getSnapshot, startSampler } from "./metrics"
import { probeAll } from "./probe"
import { startRecorder } from "./recorder"
import { defaultInterface, listInterfaces } from "./network"
import { listMounts } from "./storage"
import type { ContainerAction } from "./types"

startSampler()
startRecorder()

const app = new Hono()
const PORT = Number(process.env.PORT ?? 8088)
const STATIC_DIR = process.env.STATIC_DIR ?? ""

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".map": "application/json; charset=utf-8",
}

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }))
app.get("/api/host", (c) => c.json(getSnapshot()))

app.get("/api/services", async (c) => {
  const manual = readServices()
  // Manual entries first (they carry the curated metadata); docker-discovered
  // services follow, deduped against the manual catalog.
  const services = [...manual, ...(await discoverServices(manual))]
  const [probed, states] = await Promise.all([
    probeAll(services),
    containerStateMap(),
  ])
  return c.json(
    probed.map((service) => ({
      ...service,
      containerState: service.container
        ? (states.get(service.container) ?? null)
        : null,
    })),
  )
})

app.get("/api/containers", async (c) => c.json(await listContainers()))

const HISTORY_WINDOWS = new Set<HistoryWindow>(["1h", "6h", "24h", "7d"])

app.get("/api/history", (c) => {
  const w = c.req.query("window") as HistoryWindow
  if (!HISTORY_WINDOWS.has(w)) return c.json({ error: "invalid window" }, 400)
  return c.json(querySeries(w))
})

app.get("/api/history/aggregate", (c) => c.json(queryAggregate()))

app.get("/api/storage", (c) => c.json({ mounts: listMounts() }))

app.get("/api/network", (c) =>
  c.json({ defaultInterface: defaultInterface(), interfaces: listInterfaces() }),
)

app.get("/api/containers/:name/logs", async (c) => {
  const name = c.req.param("name")
  try {
    const text = await containerLogs(name, 200)
    return c.json({ name, text })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503)
  }
})

app.post("/api/containers/:name/:action", async (c) => {
  const name = c.req.param("name")
  const action = c.req.param("action")
  if (action !== "start" && action !== "stop" && action !== "restart") {
    return c.json({ error: "invalid action" }, 400)
  }
  try {
    await controlContainer(name, action as ContainerAction)
    return c.json({ ok: true, name, action })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503)
  }
})

// Static frontend (production single-container mode). In dev the Vite dev server
// serves the frontend and proxies /api here, so STATIC_DIR is unset.
if (STATIC_DIR && existsSync(STATIC_DIR)) {
  const indexHtml = readFileSync(join(STATIC_DIR, "index.html"), "utf8")
  const fileCache = new Map<string, { body: Uint8Array; type: string }>()

  app.get("*", (c) => {
    const reqPath = decodeURIComponent(c.req.path)
    const safe = normalize(join(STATIC_DIR, reqPath))
    if (safe.startsWith(STATIC_DIR)) {
      let hit = fileCache.get(safe)
      if (!hit) {
        try {
          if (existsSync(safe) && statSync(safe).isFile()) {
            hit = {
              body: new Uint8Array(readFileSync(safe)),
              type: MIME[extname(safe)] ?? "application/octet-stream",
            }
            fileCache.set(safe, hit)
          }
        } catch {
          /* fall through to SPA fallback */
        }
      }
      if (hit) {
        return new Response(hit.body, {
          headers: {
            "content-type": hit.type,
            "cache-control": "public, max-age=3600",
          },
        })
      }
    }
    return c.html(indexHtml)
  })
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`server-homepage listening on http://localhost:${info.port}`)
})
