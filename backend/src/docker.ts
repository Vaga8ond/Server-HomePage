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
export async function containerLogs(name: string, tail = 200): Promise<string> {
  const d = client()
  if (!d) throw new Error("docker socket unavailable")
  // follow:false → dockerode resolves a Buffer of multiplexed stream frames.
  const buf = (await d.getContainer(name).logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
    follow: false,
  })) as unknown as Buffer
  return demuxBuffer(buf)
}
