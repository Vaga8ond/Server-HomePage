import { AlertTriangle, CheckCircle2, HeartPulse, Play, Square, type IconNode } from "lucide"
import { MorphIcon } from "morphicons/react"

import { fetchEvents, fetchUptime, type ContainerEvent } from "@/lib/api"
import { serviceFlips, type ServiceFlip } from "@/lib/health"
import { usePoll } from "@/lib/use-poll"

const ACTION_META: Record<
  string,
  { icon: IconNode; color: string; label: string }
> = {
  start: { icon: Play, color: "var(--accent-green)", label: "started" },
  die: { icon: Square, color: "var(--accent-red)", label: "stopped" },
  oom: { icon: AlertTriangle, color: "var(--accent-red)", label: "OOM killed" },
  health_status: { icon: HeartPulse, color: "var(--accent-cyan)", label: "health" },
  "service-down": {
    icon: AlertTriangle,
    color: "var(--accent-red)",
    label: "went down",
  },
  "service-degraded": {
    icon: AlertTriangle,
    color: "var(--accent-amber)",
    label: "degraded",
  },
  "service-recovered": {
    icon: CheckCircle2,
    color: "var(--accent-green)",
    label: "recovered",
  },
}

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Unified activity feed: container lifecycle events + service up/down flips
 *  derived from the uptime buckets ("today on this machine", worst first). */
export function EventsTimeline() {
  const { data, loading } = usePoll(() => fetchEvents(24), 30_000)
  const { data: uptime } = usePoll(() => fetchUptime("24h"), 60_000)

  const events: (ContainerEvent | ServiceFlip)[] = data?.events ?? []
  const flips = (uptime?.services ?? []).flatMap((s) =>
    serviceFlips(s.name, s.cells),
  )
  const merged = [...events, ...flips]
    .sort((a, b) => b.t - a.t)
    .slice(0, 50)

  return (
    <div className="glass-card px-[22px] pb-4 pt-[22px]">
      <div className="mb-3.5">
        <div className="mb-0.5 text-sm font-semibold text-ink">Activity</div>
        <div className="mono text-[11px] text-ink-faint">last 24h · live</div>
      </div>

      {loading && merged.length === 0 ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-ink/5" />
          ))}
        </div>
      ) : merged.length === 0 ? (
        <div className="py-8 text-center text-xs text-ink-faint">no recent activity</div>
      ) : (
        <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1">
          {merged.map((e) => {
            const meta = ACTION_META[e.action] ?? {
              icon: Square,
              color: "#94a3b8",
              label: e.action,
            }
            return (
              <li
                key={`${e.t}-${e.container}-${e.action}`}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-ink/[0.04]"
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "color-mix(in srgb, currentColor 12%, transparent)", color: meta.color }}
                >
                  <MorphIcon icon={meta.icon} size={13} />
                </span>
                <span className="mono min-w-0 flex-1 truncate text-xs font-medium text-ink">
                  {e.container}
                </span>
                <span
                  className="shrink-0 text-[11px]"
                  style={{
                    color:
                      e.action === "service-down" || e.action === "service-degraded" || e.action === "oom"
                        ? meta.color
                        : undefined,
                  }}
                >
                  {e.detail != null ? e.detail.split(":")[1]?.trim() || meta.label : meta.label}
                </span>
                <span className="mono w-14 shrink-0 text-right text-[10px] text-ink-faint">
                  {timeAgo(e.t)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
