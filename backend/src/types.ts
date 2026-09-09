export type ServiceStatus = "running" | "stopped" | "error"

export interface ServiceConfig {
  id: string
  name: string
  category: string
  iconKey: string
  color: string
  port: number
  /** "http" (default) or "https" — services on the same host as the dashboard. */
  scheme?: "http" | "https"
  /** Docker container name (for start/stop control). Optional. */
  container?: string
  /** Explicit URL override — for services on another machine. Optional. */
  url?: string
  /** Skip HTTP probing — status derives from the mapped container state.
   *  For services without an HTTP surface (e.g. databases). Optional. */
  probe?: boolean
}

export interface ServiceStatusResult extends ServiceConfig {
  status: ServiceStatus
  latencyMs: number | null
  checkedAt: number
  /** Docker container state if a container is mapped, e.g. "running" / "exited". */
  containerState?: string | null
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
  /** Default-route NIC link speed in Mbps (gauges scale to it); null unknown. */
  netMaxMbps: number | null
  /** Host identity, read from the hostfs mounts (container sees its own /etc otherwise). */
  hostInfo: { hostname: string | null; os: string | null } | null
}
