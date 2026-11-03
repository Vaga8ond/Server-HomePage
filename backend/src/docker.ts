import Docker from "dockerode"

import type { ContainerAction, ContainerInfo, ServiceConfig } from "./types"

let docker: Docker | null = null

function client(): Docker | null {
  if (docker) return docker
  try {
    docker = new Docker()
    return docker
  } catch {
    return null
  }
}

function cpuPercentFromStats(stats: any): number | null {
  const cu = stats?.cpu_stats?.cpu_usage?.total_usage
  const pcu = stats?.precpu_stats?.cpu_usage?.total_usage
  const sys = stats?.cpu_stats?.system_cpu_usage
  const psys = stats?.precpu_stats?.system_cpu_usage
  const online = stats?.cpu_stats?.online_cpus || 1
  if (cu == null || pcu == null || sys == null || psys == null) return null
  const cpuDelta = cu - pcu
  const sysDelta = sys - psys
  if (sysDelta <= 0 || cpuDelta < 0) return null
  return (cpuDelta / sysDelta) * online * 100
}

interface ListCache {
  ts: number
  data: ContainerInfo[]
}
let listCache: ListCache | null = null
const LIST_CACHE_MS = 2000

export async function listContainers(): Promise<ContainerInfo[]> {
  const d = client()
  if (!d) return []
  if (listCache && Date.now() - listCache.ts < LIST_CACHE_MS) return listCache.data

  let raw: Docker.ContainerInfo[]
  try {
    raw = await d.listContainers({ all: true })
  } catch {
    return listCache?.data ?? []
  }

  const infos = await Promise.all(
    raw.map(async (c) => {
      const info: ContainerInfo = {
        id: c.Id,
        name: (c.Names[0] ?? "").replace(/^\//, ""),
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: (c.Ports ?? [])
          .filter((p) => p.PublicPort != null)
          .map((p) => `${p.PublicPort}/${p.Type ?? "tcp"}`),
        cpuPercent: null,
        memUsage: null,
        memPercent: null,
      }
      if (c.State !== "running") return info
      try {
        const stats = await d.getContainer(c.Id).stats({ stream: false })
        info.cpuPercent = cpuPercentFromStats(stats)
        const usage = stats?.memory_stats?.usage
        const limit = stats?.memory_stats?.limit
        if (usage != null) {
          info.memUsage = usage
          if (limit && limit > 0) info.memPercent = (usage / limit) * 100
        }
      } catch {
        /* stats unavailable — leave nulls */
      }
      return info
    }),
  )

  listCache = { ts: Date.now(), data: infos }
  return infos
}

/** name → container state, for enriching /api/services. */
export async function containerStateMap(): Promise<Map<string, string>> {
  const containers = await listContainers()
  const map = new Map<string, string>()
  for (const c of containers) map.set(c.name, c.state)
  return map
}

// Same hint table as the frontend's imageToIconKey — kept in sync by hand.
// ponytail: duplicated mapping; extract to a shared module if it drifts.
const IMAGE_HINTS: [RegExp, string][] = [
  [/immich|photo|plex|jellyfin|emby|navidrome/, "images"],
  [/postgres|mysql|mariadb|mongo/, "database"],
  [/redis|valkey|memcach/, "zap"],
  [/nginx|traefik|caddy/, "globe"],
  [/prometheus|grafana|zabbix/, "gauge"],
  [/git|gitea|forgejo/, "git"],
  [/qemu|kvm|pve|proxmox/, "cpu"],
  [/torrent|transmission|qbit/, "download"],
  [/node|bun|deno/, "code"],
  [/python|pip/, "terminal"],
  [/api|gateway/, "link"],
]

const AUTO_COLORS = ["#00E5FF", "#A855F7", "#22C55E", "#F59E0B", "#3B82F6"]

/** Auto-discovered services: running containers with a published port.
 *  Derived fresh from docker on every call — new deployments show up on the
 *  dashboard without touching services.json. Manual entries (matched by
 *  container name or port) win and provide the nicer metadata. */
export async function discoverServices(
  manual: { container?: string; port: number }[],
): Promise<ServiceConfig[]> {
  const containers = await listContainers()
  const takenContainers = new Set(manual.map((m) => m.container).filter(Boolean))
  const takenPorts = new Set(manual.map((m) => m.port))

  const out: ServiceConfig[] = []
  for (const c of containers) {
    if (c.state !== "running") continue
    const tcp = c.ports
      .map((p) => Number(p.split("/")[0]))
      .filter((p) => Number.isFinite(p) && p > 0)
    const port = tcp[0]
    if (port == null) continue
    if (takenContainers.has(c.name) || takenPorts.has(port)) continue

    let iconKey = "container"
    const image = c.image.toLowerCase()
    for (const [re, key] of IMAGE_HINTS) if (re.test(image)) { iconKey = key; break }

    let hash = 0
    for (const ch of c.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0

    out.push({
      id: `auto:${c.name}`,
      name: c.name,
      category: "docker",
      iconKey,
      color: AUTO_COLORS[Math.abs(hash) % AUTO_COLORS.length],
      port,
      scheme: "http",
      container: c.name,
    })
  }
  return out
}

export async function controlContainer(
  name: string,
  action: ContainerAction,
): Promise<void> {
  const d = client()
  if (!d) throw new Error("docker socket unavailable")
  const container = d.getContainer(name)
  if (action === "start") await container.start()
  else if (action === "stop") await container.stop()
  else if (action === "restart") await container.restart()
  listCache = null // invalidate so the next read reflects the new state
}

/** Strip docker's 8-byte stream frames from a non-tty log buffer. */
function demuxBuffer(buf: Buffer): string {
  const parts: Buffer[] = []
  let off = 0
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off + 4)
    if (off + 8 + size > buf.length) break
    parts.push(buf.subarray(off + 8, off + 8 + size))
    off += 8 + size
  }
  // No parseable framing (tty output or tiny log) — return as-is.
  const text = parts.length ? Buffer.concat(parts).toString("utf8") : buf.toString("utf8")
  // Strip ANSI escapes (colors/cursors) — they render as junk in the UI.
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
}

/** Last `tail` log lines of a container, stdout+stderr combined. */
export async function containerLogs(
  name: string,
  tail = 200,
  since?: number, // unix seconds — docker filters lines after this instant
): Promise<string> {
  const d = client()
  if (!d) throw new Error("docker socket unavailable")
  // timestamps → RFC3339 prefix per line; the frontend peels it for the time
  // column (multi-line stack-trace continuations stay timestampless).
  const buf = (await d.getContainer(name).logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
    follow: false,
    ...(since ? { since } : {}),
  })) as unknown as Buffer
  return demuxBuffer(buf)
}

export interface ComposeProject {
  project: string
  containers: string[]
}

/** Derive a compose project name from a bare container name (label-less
 *  fallback): compose names look like `<project>-<service>-<index>`. */
function nameProject(rawName: string): string | undefined {
  const m = /^\/(.+-[^-]+)-(\d+)$/.exec(rawName)
  return m?.[1]
}

let projectsCache: { at: number; data: ComposeProject[] } | null = null
const PROJECTS_CACHE_MS = 5000

/** Running containers grouped by compose project (label first, name-pattern
 *  fallback). Standalone containers have no project and are omitted. */
export async function listComposeProjects(): Promise<ComposeProject[]> {
  if (projectsCache && Date.now() - projectsCache.at < PROJECTS_CACHE_MS) {
    return projectsCache.data
  }
  const d = client()
  if (!d) throw new Error("docker socket unavailable")
  const infos = await d.listContainers({ all: false })
  const byProject = new Map<string, string[]>()
  for (const info of infos) {
    const name = (info.Names?.[0] ?? "").replace(/^\//, "")
    if (!name) continue
    const project =
      (info.Labels ?? {})["com.docker.compose.project"] ?? nameProject(info.Names?.[0] ?? "")
    if (!project) continue
    const list = byProject.get(project) ?? []
    list.push(name)
    byProject.set(project, list)
  }
  const data = [...byProject.entries()]
    .map(([project, containers]) => ({ project, containers: containers.sort() }))
    .sort((a, b) => a.project.localeCompare(b.project))
  projectsCache = { at: Date.now(), data }
  return data
}

/**
 * Follow several containers' logs at once, tagging each line with its
 * container name (SSE merged-view source). Containers that vanish mid-open
 * are skipped; a stream that ends (container stopped) just goes silent.
 */
export async function streamMergedLogs(
  names: string[],
  tail = 200,
  onLine: (name: string, stream: "stdout" | "stderr", line: string) => void,
): Promise<() => void> {
  const cancels = await Promise.all(
    names.map(async (n) => {
      try {
        return await streamContainerLogs(n, tail, (type, line) => onLine(n, type, line))
      } catch {
        return () => {} // container gone between list and logs — skip it
      }
    }),
  )
  return () => cancels.forEach((c) => c())
}

const STREAM_TYPE = (t: number): "stdout" | "stderr" => (t === 2 ? "stderr" : "stdout")

/**
 * Follow a container's log stream (SSE source). Calls `onLine` with each
 * complete line; returns a cancel function that tears down the docker stream.
 * Incremental variant of demuxBuffer: same 8-byte framing, tty-safe (a bad
 * header falls back to raw passthrough), same ANSI stripping, same
 * timestamps: true prefix contract as the snapshot endpoint.
 */
export async function streamContainerLogs(
  name: string,
  tail = 200,
  onLine: (stream: "stdout" | "stderr", line: string) => void,
): Promise<() => void> {
  const d = client()
  if (!d) throw new Error("docker socket unavailable")
  const s = (await d.getContainer(name).logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
    follow: true,
  })) as unknown as import("node:stream").Readable

  let buf = Buffer.alloc(0)
  let partial = "" // incomplete line carried across chunks
  const pushText = (text: string) => {
    partial += text
    const lines = partial.split("\n")
    partial = lines.pop() ?? ""
    for (const l of lines) {
      const clean = l.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
      if (clean.trim()) onLine("stdout", clean)
    }
  }
  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    // tty passthrough: only when framing is definitively invalid (type byte
    // out of range or the reserved 3 bytes non-zero) — partial frames wait.
    if (buf.length >= 4 && (buf[0] > 2 || buf[1] !== 0 || buf[2] !== 0 || buf[3] !== 0)) {
      pushText(buf.toString("utf8"))
      buf = Buffer.alloc(0)
      return
    }
    let off = 0
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off + 4)
      if (size >= 1 << 24) break // framing lost — stop, next chunk re-checks
      if (off + 8 + size > buf.length) break
      const type = STREAM_TYPE(buf[off])
      pushText(buf.subarray(off + 8, off + 8 + size).toString("utf8"))
      off += 8 + size
    }
    if (off > 0) buf = buf.subarray(off)
  }
  const onEnd = () => {
    if (partial.trim()) onLine("stdout", partial)
    partial = ""
  }
  s.on("data", onData)
  s.on("end", onEnd)
  s.on("error", () => {}) // docker closes abruptly — client reconnects
  return () => {
    s.destroy()
  }
}
