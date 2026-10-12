import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * External devices (e.g. a NAS) surfaced on the dashboard. Metrics come from
 * a glances container running on the device itself (REST API :61208); a
 * device without one degrades to a plain reachability check.
 */
export interface DeviceConfig {
  id: string
  name: string
  host: string
  /** Web UI of the device — used for the dashboard click-through link. */
  url?: string
  /** Glances REST base (e.g. http://ip:61208). Absent → reachability only. */
  glancesUrl?: string
}

export interface DeviceFsEntry {
  mount: string
  device: string
  fstype: string
  total: number
  used: number
  free: number
  percent: number
}

export interface DeviceStatus {
  id: string
  name: string
  host: string
  url: string | null
  online: boolean
  cpuPercent: number | null
  memPercent: number | null
  memUsed: number | null
  memTotal: number | null
  temperatureC: number | null
  loadOne: number | null
  uptimeSeconds: number | null
  filesystems: DeviceFsEntry[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DEVICES_PATH =
  process.env.DEVICES_CONFIG ?? join(HERE, "..", "config", "devices.json")

const CACHE_MS = 5000
const TIMEOUT_MS = 3000

let lastGood: DeviceConfig[] = []
let lastWarn = 0
let cache: { ts: number; data: DeviceStatus[] } | null = null

function warn(msg: string): void {
  if (Date.now() - lastWarn < 60_000) return
  lastWarn = Date.now()
  console.warn(`devices: ${msg}`)
}

/** Read on every call — devices.json is a per-server file, edited live
 *  (same contract as readServices in config.ts). Broken file → last good. */
export function readDevices(): DeviceConfig[] {
  try {
    const raw = JSON.parse(readFileSync(DEVICES_PATH, "utf8")) as {
      devices?: unknown
    }
    if (!Array.isArray(raw.devices)) throw new Error("devices[] missing")
    const valid = raw.devices.filter(
      (d): d is DeviceConfig =>
        !!d &&
        typeof d === "object" &&
        typeof (d as DeviceConfig).id === "string" &&
        typeof (d as DeviceConfig).name === "string" &&
        typeof (d as DeviceConfig).host === "string",
    )
    lastGood = valid
    return valid
  } catch (err) {
    warn(
      `${DEVICES_PATH} unreadable (${(err as Error).message}) — ` +
        `serving last good list (${lastGood.length} devices)`,
    )
    return lastGood
  }
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Glances reports uptime as seconds in some API versions, a human string
 *  ("2 days, 3:14:15") in others — accept both. */
function uptimeSeconds(v: unknown): number | null {
  const n = num(v)
  if (n != null) return n
  if (typeof v !== "string") return null
  let s = 0
  const days = v.match(/(\d+)\s*day/)
  const hms = v.match(/(\d+):(\d+):(\d+)/)
  if (days) s += Number(days[1]) * 86_400
  if (hms) s += Number(hms[1]) * 3_600 + Number(hms[2]) * 60 + Number(hms[3])
  return s || null
}

interface GlancesAll {
  cpu?: { total?: unknown }
  mem?: { total?: unknown; used?: unknown }
  load?: { min1?: unknown }
  uptime?: unknown
  sensors?: { label?: string; type?: string; value?: unknown }[]
  fs?: { device_name?: string; mnt_point?: string; fs_type?: string; size?: unknown; used?: unknown }[]
}

async function fetchGlances(base: string): Promise<GlancesAll> {
  const root = base.replace(/\/+$/, "")
  for (const ver of ["v4", "v3"]) {
    try {
      const res = await fetch(`${root}/api/${ver}/all`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) return (await res.json()) as GlancesAll
    } catch {
      /* try the older API version */
    }
  }
  throw new Error("glances api unreachable")
}

async function pollOne(d: DeviceConfig): Promise<DeviceStatus> {
  const base: DeviceStatus = {
    id: d.id,
    name: d.name,
    host: d.host,
    url: d.url ?? null,
    online: false,
    cpuPercent: null,
    memPercent: null,
    memUsed: null,
    memTotal: null,
    temperatureC: null,
    loadOne: null,
    uptimeSeconds: null,
    filesystems: [],
  }
  if (!d.glancesUrl) {
    try {
      await fetch(d.url ?? `http://${d.host}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return { ...base, online: true }
    } catch {
      return base
    }
  }
  try {
    const j = await fetchGlances(d.glancesUrl)
    const memTotal = num(j.mem?.total)
    const memUsed = num(j.mem?.used)
    // Dedupe by mount point; ≥1GB cuts container-internal junk mounts
    // (tmpfs, /etc/hosts binds) so only real volumes survive.
    const seen = new Set<string>()
    const filesystems = (j.fs ?? [])
      .filter((f) => {
        if (!f.mnt_point || seen.has(f.mnt_point)) return false
        seen.add(f.mnt_point)
        return (num(f.size) ?? 0) >= 1e9
      })
      .map((f) => {
        const total = num(f.size) ?? 0
        const used = num(f.used) ?? 0
        return {
          mount: f.mnt_point as string,
          device: f.device_name ?? (f.mnt_point as string),
          fstype: f.fs_type ?? "",
          total,
          used,
          free: Math.max(0, total - used),
          percent: total > 0 ? (used / total) * 100 : 0,
        }
      })
    const temps = (j.sensors ?? [])
      .map((s) =>
        s.type?.includes("temperature") || /temp|cpu|core/i.test(s.label ?? "")
          ? num(s.value)
          : null,
      )
      .filter((t): t is number => t != null)
    return {
      ...base,
      online: true,
      cpuPercent: num(j.cpu?.total),
      memTotal,
      memUsed,
      memPercent: memTotal && memUsed ? (memUsed / memTotal) * 100 : null,
      temperatureC: temps.length ? Math.max(...temps) : null,
      loadOne: num(j.load?.min1),
      uptimeSeconds: uptimeSeconds(j.uptime),
      filesystems,
    }
  } catch {
    return base
  }
}

export async function pollDevices(): Promise<DeviceStatus[]> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.data
  const data = await Promise.all(readDevices().map(pollOne))
  cache = { ts: Date.now(), data }
  return data
}
