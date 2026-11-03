export type ServiceStatus = "running" | "stopped" | "error"

export interface ApiService {
  id: string
  name: string
  category: string
  iconKey: string
  color: string
  port: number
  scheme?: "http" | "https"
  container?: string
  /** Explicit URL override (services on another machine). */
  url?: string | null
  status: ServiceStatus
  latencyMs: number | null
  checkedAt: number
  containerState?: string | null
}

export interface HostMetrics {
  ts: number
  cpu: { percent: number } | null
  memory: { used: number; total: number; percent: number } | null
  disk: { used: number; total: number; percent: number } | null
  network: { rxBytesPerSec: number; txBytesPerSec: number } | null
  load: { one: number; five: number; fifteen: number } | null
  processes: number | null
  tcpConnections: number | null
  temperatureC: number | null
  uptimeSeconds: number | null
  netMaxMbps?: number | null
  hostInfo?: { hostname: string | null; os: string | null } | null
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string[]
  cpuPercent: number | null
  memUsage: number | null
  memPercent: number | null
}

export type ContainerAction = "start" | "stop" | "restart"

export type UptimeWindow = "24h" | "7d"

export interface UptimeCell {
  t: number
  /** running / total probes in the cell; null = no probes (unknown). */
  ratio: number | null
  latencyMs: number | null
}

export interface ServiceUptime {
  name: string
  uptimePct: number | null
  cells: UptimeCell[]
}

export interface UptimeSeries {
  window: UptimeWindow
  stepMs: number
  from: number
  to: number
  services: ServiceUptime[]
}

export type HistoryWindow = "1h" | "6h" | "24h" | "7d"
/** Preset windows plus arbitrary from/to ranges resolved by the backend. */
export type SeriesWindow = HistoryWindow | "custom"

export interface HistoryPoint {
  t: number
  cpu: number | null
  mem: number | null
  disk: number | null
  rx: number | null
  tx: number | null
  load: number | null
  tcp: number | null
  temp: number | null
}

export interface HistorySeries {
  window: SeriesWindow
  stepMs: number
  from: number
  to: number
  points: HistoryPoint[]
}

export interface WeeklyStat {
  rxGB: number
  txGB: number
  cpuAvg: number | null
}

export interface HistoryAggregate {
  weekly: WeeklyStat[]
  heatmap: (number | null)[]
  maxMbps: number
}

export interface StorageMount {
  device: string
  mount: string
  fstype: string
  total: number
  used: number
  free: number
  percent: number
}

export interface NetInterface {
  name: string
  state: string
  speedMbps: number | null
  addresses: string[]
  rxBytes: number | null
  txBytes: number | null
}

const API = "/api"
const TOKEN_KEY = "hb-api-token"

/** Bearer token persisted in localStorage — entered once in the token gate. */
export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ""
  } catch {
    return ""
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

let onUnauthorized: (() => void) | null = null
/** App registers a callback — any 401 flips the UI into the token gate. */
export function setOnUnauthorized(fn: () => void): void {
  onUnauthorized = fn
}

async function request(path: string, init?: { method?: string }): Promise<Response> {
  const token = getToken()
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401) {
    onUnauthorized?.()
    throw new Error("unauthorized")
  }
  return res
}

export async function fetchHost(): Promise<HostMetrics> {
  const res = await request("/host")
  if (!res.ok) throw new Error(`host ${res.status}`)
  return (await res.json()) as HostMetrics
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

export async function fetchDevices(): Promise<DeviceStatus[]> {
  const res = await request("/devices")
  if (!res.ok) throw new Error(`devices ${res.status}`)
  return (await res.json()) as DeviceStatus[]
}

export async function fetchServices(): Promise<ApiService[]> {
  const res = await request("/services")
  if (!res.ok) throw new Error(`services ${res.status}`)
  return (await res.json()) as ApiService[]
}

export interface ComposeProject {
  project: string
  containers: string[]
}

export async function fetchComposeProjects(): Promise<ComposeProject[]> {
  const res = await request(`/compose-projects`)
  if (!res.ok) throw new Error(`compose-projects ${res.status}`)
  return (await res.json()) as ComposeProject[]
}

export async function fetchContainers(): Promise<ContainerInfo[]> {
  const res = await request("/containers")
  if (!res.ok) throw new Error(`containers ${res.status}`)
  return (await res.json()) as ContainerInfo[]
}

export async function controlContainer(
  name: string,
  action: ContainerAction,
): Promise<void> {
  const res = await request(
    `/containers/${encodeURIComponent(name)}/${action}`,
    { method: "POST" },
  )
  if (!res.ok) throw new Error(`control ${res.status}`)
}

export async function fetchHistory(
  window: HistoryWindow | "custom",
  range?: { from: number; to: number },
): Promise<HistorySeries> {
  const qs = range ? `&from=${range.from}&to=${range.to}` : ""
  const res = await request(`/history?window=${window}${qs}`)
  if (!res.ok) throw new Error(`history ${res.status}`)
  return (await res.json()) as HistorySeries
}

export async function fetchHistoryAggregate(): Promise<HistoryAggregate> {
  const res = await request("/history/aggregate")
  if (!res.ok) throw new Error(`history aggregate ${res.status}`)
  return (await res.json()) as HistoryAggregate
}

export async function fetchUptime(window: UptimeWindow): Promise<UptimeSeries> {
  const res = await request(`/uptime?window=${window}`)
  if (!res.ok) throw new Error(`uptime ${res.status}`)
  return (await res.json()) as UptimeSeries
}

export interface ContainerEvent {
  t: number
  container: string
  action: string
  detail: string | null
}

export async function fetchEvents(hours = 24): Promise<{ events: ContainerEvent[] }> {
  const res = await request(`/events?hours=${hours}`)
  if (!res.ok) throw new Error(`events ${res.status}`)
  return (await res.json()) as { events: ContainerEvent[] }
}

export async function fetchStorage(): Promise<{ mounts: StorageMount[] }> {
  const res = await request("/storage")
  if (!res.ok) throw new Error(`storage ${res.status}`)
  return (await res.json()) as { mounts: StorageMount[] }
}

export async function fetchNetwork(): Promise<{
  defaultInterface: string | null
  interfaces: NetInterface[]
}> {
  const res = await request("/network")
  if (!res.ok) throw new Error(`network ${res.status}`)
  return (await res.json()) as {
    defaultInterface: string | null
    interfaces: NetInterface[]
  }
}

export async function fetchContainerLogs(
  name: string,
  tail = 500,
  range?: { kind: "1h" | "24h" | "custom"; from?: string; to?: string },
): Promise<string> {
  const params = new URLSearchParams({ tail: String(tail) })
  if (range) {
    params.set("since", range.kind)
    if (range.from) params.set("from", range.from)
    if (range.to) params.set("to", range.to)
  }
  const res = await request(
    `/containers/${encodeURIComponent(name)}/logs?${params}`,
  )
  if (!res.ok) throw new Error(`logs ${res.status}`)
  const body = (await res.json()) as { text: string }
  return body.text
}
