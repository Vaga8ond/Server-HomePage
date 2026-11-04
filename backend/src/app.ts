import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"

import { Hono } from "hono"

import { readServices, apiToken } from "./config"
import {
  containerLogs,
  containerStateMap,
  controlContainer,
  discoverServices,
  listContainers,
  listComposeProjects,
  streamContainerLogs,
  streamMergedLogs,
} from "./docker"
import { startDockerEvents } from "./docker-events"
import { recentEvents } from "./store"
import {
  queryAggregate,
  querySeries,
  type SeriesWindow,
} from "./history"
import { queryUptime, type UptimeWindow } from "./uptime"
import { getSnapshot, startSampler } from "./metrics"
import { probeAll, startProber } from "./probe"
import { startRecorder } from "./recorder"
import { defaultInterface, listInterfaces } from "./network"
import { pollDevices } from "./devices"
import { listMounts } from "./storage"
import type { ContainerAction } from "./types"

startSampler()
startRecorder()
startProber()
startDockerEvents()

export const app = new Hono()

// Bearer auth for /api (static SPA stays open so the browser can prompt for
// the token). /api/health stays public for monitoring. No token configured →
// API stays open (local dev).
const API_TOKEN = apiToken()
if (API_TOKEN) {
  console.log("api auth: enabled")
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next()
    // ?token= query form exists solely for EventSource, which cannot set
    // headers (SSE log stream); Authorization header is the primary form.
    if (
      c.req.header("authorization") !== `Bearer ${API_TOKEN}` &&
      c.req.query("token") !== API_TOKEN
    ) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  })
}

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
app.get("/api/devices", async (c) => c.json(await pollDevices()))

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
    probed.map((service) => {
      const state = service.container
        ? (states.get(service.container) ?? null)
        : null
      return {
        ...service,
        // probe:false services carry no HTTP status — derive it from the
        // mapped container state instead of the placeholder from probeAll.
        ...(service.probe === false
          ? { status: state === "running" ? ("running" as const) : ("stopped" as const) }
          : {}),
        containerState: state,
      }
    }),
  )
})

app.get("/api/containers", async (c) => c.json(await listContainers()))

const HISTORY_WINDOWS = new Set<SeriesWindow>(["1h", "6h", "24h", "7d", "custom"])

app.get("/api/history", (c) => {
  const w = c.req.query("window") as SeriesWindow
  if (!HISTORY_WINDOWS.has(w)) return c.json({ error: "invalid window" }, 400)
  if (w === "custom") {
    try {
      return c.json(
        querySeries("custom", {
          from: Number(c.req.query("from")),
          to: Number(c.req.query("to")),
        }),
      )
    } catch {
      return c.json({ error: "invalid range" }, 400)
    }
  }
  return c.json(querySeries(w))
})

const UPTIME_WINDOWS = new Set<UptimeWindow>(["24h", "7d"])

app.get("/api/uptime", (c) => {
  const w = c.req.query("window") as UptimeWindow
  if (!UPTIME_WINDOWS.has(w)) return c.json({ error: "invalid window" }, 400)
  return c.json(queryUptime(w))
})

app.get("/api/events", (c) => {
  // Clamp 1h..30d; bad values fall back to the 24h default.
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 720)
  return c.json({ events: recentEvents(Date.now() - hours * 3_600_000) })
})

app.get("/api/history/aggregate", (c) => c.json(queryAggregate()))

app.get("/api/storage", (c) => c.json({ mounts: listMounts() }))

app.get("/api/network", (c) =>
  c.json({ defaultInterface: defaultInterface(), interfaces: listInterfaces() }),
)

app.get("/api/containers/:name/logs", async (c) => {
  const name = c.req.param("name")
  // Clamp 50..5000; bad values fall back to the 500 default.
  const tail = Math.min(Math.max(Number(c.req.query("tail")) || 500, 50), 5000)
  // ?since=1h|24h|custom (+from/to, same semantics as /api/history custom) —
  // invalid/missing pieces fall back to "no since filter" (tail only).
  const now = Date.now()
  let since: number | undefined
  const spec = c.req.query("since")
  if (spec === "1h") since = Math.floor((now - 3600_000) / 1000)
  else if (spec === "24h") since = Math.floor((now - 24 * 3600_000) / 1000)
  else if (spec === "custom") {
    const from = Date.parse(c.req.query("from") ?? "")
    if (!Number.isNaN(from)) since = Math.floor(from / 1000)
  }
  try {
    const text = await containerLogs(name, tail, since)
    return c.json({ name, text })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503)
  }
})

app.get("/api/containers/:name/logs/stream", (c) => {
  const name = c.req.param("name")
  const tail = Math.min(Math.max(Number(c.req.query("tail")) || 500, 50), 5000)
  const encoder = new TextEncoder()
  let cancel: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    cancel?.()
    cancel = null
  }
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch {
          /* controller closed by cancel() */
        }
      }
      // Client disconnect (fetch/EventSource abort) → tear everything down.
      c.req.raw.signal.addEventListener("abort", cleanup)
      try {
        cancel = await streamContainerLogs(name, tail, (type, line) =>
          send("line", { type, line }),
        )
        send("open", { name })
        // Keep proxies from closing an idle stream; SSE comment frames are
        // ignored by EventSource.
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            /* closed */
          }
        }, 30000)
      } catch (err) {
        send("error", { message: (err as Error).message })
        cleanup()
        controller.close()
      }
    },
    cancel() {
      cleanup()
    },
  })
  return c.body(stream, 200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
})

app.get("/api/compose-projects", async (c) => {
  try {
    return c.json(await listComposeProjects())
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503)
  }
})

app.get("/api/logs/merged", (c) => {
  const project = c.req.query("project") ?? ""
  const tail = Math.min(Math.max(Number(c.req.query("tail")) || 500, 50), 5000)
  const encoder = new TextEncoder()
  let cancel: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    cancel?.()
    cancel = null
  }
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch {
          /* controller closed */
        }
      }
      c.req.raw.signal.addEventListener("abort", cleanup)
      try {
        const match = (await listComposeProjects()).find((p) => p.project === project)
        if (!match || match.containers.length === 0) {
          send("error", { message: `no running containers for project "${project}"` })
          cleanup()
          controller.close()
          return
        }
        cancel = await streamMergedLogs(match.containers, tail, (name, type, line) =>
          send("line", { name, type, line }),
        )
        send("open", { project, containers: match.containers })
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            /* closed */
          }
        }, 30000)
      } catch (err) {
        send("error", { message: (err as Error).message })
        cleanup()
        controller.close()
      }
    },
    cancel() {
      cleanup()
    },
  })
  return c.body(stream, 200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
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
  const fileCache = new Map<
    string,
    { body: Uint8Array; type: string; mtimeMs: number }
  >()

  app.get("*", (c) => {
    const reqPath = decodeURIComponent(c.req.path)
    const safe = normalize(join(STATIC_DIR, reqPath))
    // Trailing separator: a bare startsWith(STATIC_DIR) would also admit
    // sibling dirs whose name merely shares the prefix ("public-backup").
    if (safe.startsWith(normalize(STATIC_DIR) + "/")) {
      let hit = fileCache.get(safe)
      if (hit) {
        // mtime check so edited files are picked up without a restart
        // (index.html is the one file this realistically matters for).
        try {
          if (statSync(safe).mtimeMs !== hit.mtimeMs) hit = undefined
        } catch {
          hit = undefined
        }
      }
      if (!hit) {
        try {
          if (existsSync(safe) && statSync(safe).isFile()) {
            hit = {
              body: new Uint8Array(readFileSync(safe)),
              type: MIME[extname(safe)] ?? "application/octet-stream",
              mtimeMs: statSync(safe).mtimeMs,
            }
            fileCache.set(safe, hit)
          }
        } catch {
          /* fall through to SPA fallback */
        }
      }
      if (hit) {
        // index.html: always revalidate (new deploys must reach browsers
        // without a hard refresh). /assets/*: content-hashed → cache forever.
        const isIndex = safe.endsWith("/index.html")
        const cacheControl = isIndex
          ? "no-cache"
          : safe.includes("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600"
        return new Response(hit.body, {
          headers: {
            "content-type": hit.type,
            "cache-control": cacheControl,
          },
        })
      }
    }
    return c.html(indexHtml, 200, { "cache-control": "no-cache" })
  })
}

