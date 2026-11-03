import { AlertTriangle, CheckCircle2 } from "lucide"
import { MorphIcon } from "morphicons/react"

import {
  fetchContainers,
  fetchEvents,
  fetchServices,
  fetchUptime,
  type ApiService,
  type ContainerInfo,
} from "@/lib/api"
import { computeHealth, type HealthSignal } from "@/lib/health"
import { usePoll } from "@/lib/use-poll"

/* Severity chips use the site's glow-token language (same as topbar status pills):
 * ok chips stay quiet (line border, faint text); warn/crit tint via glow tokens. */
const SEVERITY_STYLE: Record<HealthSignal["severity"], string> = {
  ok: "border-line text-ink-faint",
  warn: "border-amber-glow/25 bg-amber-glow/10 text-amber-glow",
  crit: "border-red-glow/25 bg-red-glow/10 text-red-glow",
}

function go(hash: string) {
  window.location.hash = hash
}

/** Top-of-overview status band: one glance, is everything fine? */
export function HealthStrip({ host }: { host: Parameters<typeof computeHealth>[0]["host"] }) {
  const { data: containers } = usePoll<ContainerInfo[]>(fetchContainers, 5_000)
  const { data: services } = usePoll<ApiService[]>(fetchServices, 5_000)
  const { data: uptime } = usePoll(
    () => fetchUptime("24h").then((r) => r.services),
    60_000,
  )
  const { data: evData } = usePoll(() => fetchEvents(24), 60_000)

  const { signals, ok } = computeHealth({
    containers,
    services,
    uptimePcts: uptime?.map((u) => u.uptimePct) ?? null,
    events: evData?.events ?? null,
    host,
  })

  const Icon = ok ? CheckCircle2 : AlertTriangle
  return (
    <div
      className={`glass-card mb-7 flex flex-wrap items-center gap-2 px-[18px] py-3 ${
        ok ? "" : "border-red-glow/25"
      }`}
    >
      <span
        className={`flex items-center gap-2 text-xs font-semibold ${
          ok ? "text-green-glow" : "text-red-glow"
        }`}
      >
        <MorphIcon icon={Icon} size={14} />
        {ok ? "All systems normal" : "Needs attention"}
      </span>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {signals.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.to)}
            className={`mono rounded-full border px-2.5 py-1 text-[10px] transition-colors hover:opacity-80 ${SEVERITY_STYLE[s.severity]}`}
            title={`Go to ${s.to.replace("#/", "")}`}
          >
            {s.count > 0 && <span className="font-bold">{s.count} </span>}
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
