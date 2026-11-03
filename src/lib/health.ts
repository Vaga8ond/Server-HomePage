import type {
  ApiService,
  ContainerEvent,
  ContainerInfo,
  HostMetrics,
} from "./api"

export type HealthSeverity = "ok" | "warn" | "crit"

/** One clickable status chip on the overview health strip. */
export interface HealthSignal {
  id: string
  /** Offending count (0 = healthy). */
  count: number
  label: string
  severity: HealthSeverity
  /** Hash route the chip navigates to. */
  to: string
}

export interface HealthInputs {
  containers: ContainerInfo[] | null
  services: ApiService[] | null
  uptimePcts: (number | null)[] | null
  events: ContainerEvent[] | null
  host: HostMetrics | null
}

export const DISK_WARN_PCT = 90
/** health_status events only count when detail says unhealthy. */
const ABNORMAL_ACTIONS = new Set(["oom"])
const CRIT_ACTIONS = new Set(["oom"])

export function diskPct(host: HostMetrics | null): number | null {
  const d = host?.disk
  if (!d || d.total <= 0) return null
  return (d.used / d.total) * 100
}

/** Overall 24h service availability: worst uptimePct across probed services. */
export function worstUptime(pcts: (number | null)[]): number | null {
  const vals = pcts.filter((v): v is number => v != null)
  return vals.length ? Math.min(...vals) : null
}

export interface ServiceFlip {
  t: number
  container: string
  action: "service-down" | "service-degraded" | "service-recovered"
  detail: null
}

/** Cell state from probe ratio: null = no data (skip), 0 = down, <1 = degraded. */
function cellState(ratio: number | null): "down" | "degraded" | "up" | null {
  if (ratio == null) return null
  if (ratio <= 0) return "down"
  if (ratio < 1) return "degraded"
  return "up"
}

/** Derive up/down flip events from a service's uptime bucket sequence.
 *  Gaps (null cells) are bridged: the flip is judged against the last
 *  non-null state, so a missing-data stretch doesn't mask a real outage. */
export function serviceFlips(
  name: string,
  cells: { t: number; ratio: number | null }[],
): ServiceFlip[] {
  const flips: ServiceFlip[] = []
  let prev: ReturnType<typeof cellState> = null
  for (const c of cells) {
    const state = cellState(c.ratio)
    if (state == null) continue
    if (prev != null && state !== prev) {
      const action =
        state === "up"
          ? "service-recovered"
          : state === "down"
            ? "service-down"
            : "service-degraded"
      flips.push({ t: c.t, container: name, action, detail: null })
    }
    prev = state
  }
  return flips
}

export function computeHealth(inputs: HealthInputs): {
  signals: HealthSignal[]
  ok: boolean
} {
  const signals: HealthSignal[] = []

  const cs = inputs.containers
  if (cs) {
    const stopped = cs.filter((c) => c.state !== "running").length
    signals.push({
      id: "containers",
      count: stopped,
      label: stopped > 0 ? "containers stopped" : "containers running",
      severity: stopped > 0 ? "warn" : "ok",
      to: "#/monitoring",
    })
  }

  const sv = inputs.services
  if (sv) {
    const down = sv.filter((s) => s.status === "error").length
    signals.push({
      id: "services",
      count: down,
      label: down > 0 ? "services down" : "services up",
      severity: down > 0 ? "crit" : "ok",
      to: "#/services",
    })
  }

  const up = inputs.uptimePcts ? worstUptime(inputs.uptimePcts) : null
  if (up != null) {
    signals.push({
      id: "uptime",
      count: 0,
      label: `min 24h uptime ${up.toFixed(1)}%`,
      severity: up < 100 ? "warn" : "ok",
      to: "#/services",
    })
  }

  const pct = diskPct(inputs.host)
  if (pct != null) {
    signals.push({
      id: "disk",
      count: 0,
      label: `disk ${pct.toFixed(0)}%`,
      severity: pct >= DISK_WARN_PCT ? "crit" : "ok",
      to: "#/storage",
    })
  }

  const evs = inputs.events
  if (evs) {
    const abnormal = evs.filter(
      (e) =>
        ABNORMAL_ACTIONS.has(e.action) ||
        (e.action === "health_status" && e.detail === "unhealthy"),
    ).length
    signals.push({
      id: "events",
      count: abnormal,
      label: "abnormal events (24h)",
      severity: abnormal > 0 ? (evs.some((e) => CRIT_ACTIONS.has(e.action)) ? "crit" : "warn") : "ok",
      to: "#/logs",
    })
  }

  return { signals, ok: signals.every((s) => s.severity === "ok") }
}
