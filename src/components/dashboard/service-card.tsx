import { useState, type CSSProperties } from "react"
import { ArrowUpRight } from "lucide"
import { MorphIcon } from "morphicons/react"

import { ContainerControls } from "@/components/dashboard/container-controls"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { getServiceIcon } from "@/lib/icons"
import { resolveServiceUrl } from "@/lib/service-url"
import type { ApiService } from "@/lib/api"

export function ServiceCard({
  service,
  onControl,
}: {
  service: ApiService
  onControl?: () => void
}) {
  const Icon = getServiceIcon(service.iconKey)
  const running = service.status === "running"
  const containerRunning = service.containerState === "running"
  // hover swaps the chip icon → ArrowUpRight; MorphIcon spring-morphs between them
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="glass-card svc-card group p-5"
      style={{ "--svc": service.color } as CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Click-to-open link wraps the head + meta; control buttons live in the
          footer, outside the <a> so they don't trigger navigation. */}
      <a
        href={resolveServiceUrl(service)}
        target="_blank"
        rel="noreferrer"
        className="block focus-visible:outline-none"
      >
        <div className="mb-3.5 flex items-start justify-between">
          <span
            className="flex size-[42px] items-center justify-center rounded-xl border"
            style={{
              background: `${service.color}18`,
              borderColor: `${service.color}30`,
            }}
          >
            <MorphIcon icon={hovered ? ArrowUpRight : Icon} size={20} color={service.color} />
          </span>
          <StatusBadge status={service.status} />
        </div>
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">{service.name}</span>
            <MorphIcon icon={ArrowUpRight} size={16} className="text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <div className="mono mt-1 text-xs text-ink-faint">
            :{service.port} · {service.category}
          </div>
        </div>
      </a>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-soft">
          {running
            ? service.latencyMs != null
              ? `${service.latencyMs} ms`
              : "Online"
            : "Offline"}
        </span>
        {service.container && service.containerState != null && (
          <ContainerControls
            name={service.container}
            running={containerRunning}
            onControl={onControl}
          />
        )}
      </div>
    </div>
  )
}
