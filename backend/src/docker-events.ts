import Docker from "dockerode"

import { insertEvent } from "./store"

/** Actions kept for the overview timeline — the rest are ignored. */
const KEEP = new Set(["start", "die", "oom", "health_status"])
const RECONNECT_MS = 5000

let docker: Docker | null = null
let reconnectTimer: NodeJS.Timeout | null = null

/** Subscribe to the Docker event stream and persist container lifecycle
 *  events. Fire-and-forget: a missing docker socket (native dev runs) just
 *  leaves the timeline empty; the stream reconnects every RECONNECT_MS. */
export function startDockerEvents(): void {
  try {
    docker ??= new Docker()
  } catch {
    console.warn("docker-events: docker socket unavailable, timeline disabled")
    return
  }
  connect()
}

function connect(): void {
  if (!docker) return
  docker.getEvents({ filters: JSON.stringify({ type: ["container"] }) }, (err, stream) => {
    if (err != null || stream == null) {
      reconnect()
      return
    }
    console.log("docker-events: listening")
    stream.on("data", (buf: Buffer) => {
      // The stream emits one JSON object per line, possibly several per chunk.
      for (const line of buf.toString().split("\n")) {
        if (!line.trim()) continue
        try {
          record(JSON.parse(line))
        } catch {
          /* malformed event line — skip */
        }
      }
    })
    stream.on("error", reconnect)
    stream.on("end", reconnect)
    stream.on("close", reconnect)
  })
}

function reconnect(): void {
  // Debounce: a single drop can fire error + end + close together.
  if (reconnectTimer != null) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_MS)
  reconnectTimer.unref()
}

interface DockerEvent {
  time?: number
  Action?: string
  status?: string
  Actor?: { Attributes?: Record<string, string> }
}

function record(e: DockerEvent): void {
  const raw = e.Action ?? e.status ?? ""
  const action = raw.split(":")[0] // "health_status: healthy" → "health_status"
  if (!KEEP.has(action)) return
  const container = e.Actor?.Attributes?.name
  if (!container) return
  const t = (e.time ?? 0) * 1000 // docker reports epoch seconds
  insertEvent(t > 0 ? t : Date.now(), container, action, raw !== action ? raw : null)
}

export { record as recordDockerEvent }
