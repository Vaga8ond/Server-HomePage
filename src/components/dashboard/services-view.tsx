import { useMemo, useState } from "react"

import { PageHeader } from "@/components/dashboard/page-header"
import { ServiceCard } from "@/components/dashboard/service-card"
import {
  Sk,
  SkeletonCard,
  StaggerGrid,
  StaggerItem,
} from "@/components/dashboard/skeleton"
import {
  fetchUptime,
  type ApiService,
  type UptimeWindow,
} from "@/lib/api"
import { usePoll } from "@/lib/use-poll"

const UPTIME_OPTIONS: Array<{ id: UptimeWindow; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
]

export function ServicesView({
  services,
  loading,
  onControl,
}: {
  services: ApiService[]
  loading: boolean
  onControl?: () => void
}) {
  const running = services.filter((s) => s.status === "running").length
  const stopped = services.filter((s) => s.status === "stopped").length
  const error = services.filter((s) => s.status === "error").length
  const showSkeleton = loading && services.length === 0

  // Availability history for the card uptime bars; changes slowly, poll 60s.
  const [uwin, setUwin] = useState<UptimeWindow>("24h")
  const { data: uptime } = usePoll(() => fetchUptime(uwin), 60_000)
  const uptimeByName = useMemo(
    () => new Map((uptime?.services ?? []).map((u) => [u.name, u])),
    [uptime],
  )

  return (
    <>
      <PageHeader
        title="Services"
        subtitle={
          showSkeleton ? (
            <Sk className="h-[19px] w-52 rounded" />
          ) : (
            `${services.length} services · ${running} running · ${stopped} stopped · ${error} error`
          )
        }
      />

      <div className="mb-4 flex items-center justify-end gap-2.5">
        <span className="mono text-[11px] text-ink-faint">availability</span>
        <div className="glass-card-sm flex gap-0.5 p-0.5">
          {UPTIME_OPTIONS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setUwin(w.id)}
              className={`mono rounded-[9px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                uwin === w.id
                  ? "text-ink"
                  : "text-ink-faint hover:text-ink-soft"
              }`}
              style={
                uwin === w.id
                  ? { background: "color-mix(in srgb, var(--accent-cyan) 15%, transparent)", color: "var(--accent-cyan)" }
                  : undefined
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {showSkeleton ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <StaggerGrid className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {services.map((service) => (
            <StaggerItem key={service.id} className="grid">
              <ServiceCard
                key={service.id}
                service={service}
                uptime={uptimeByName.get(service.name)}
                onControl={onControl}
              />
            </StaggerItem>
          ))}
        </StaggerGrid>
      )}
    </>
  )
}
