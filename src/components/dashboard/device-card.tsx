import type { CSSProperties } from "react"

import { chartColors } from "@/components/dashboard/charts/chart-tooltip"
import type { DeviceStatus } from "@/lib/api"

/** External device card (e.g. a NAS) — lives in the Overview "Devices" row.
 *  Metrics come from /api/devices (glances on the device); no source → the
 *  card degrades to an online/offline tile with a link to the web UI. */
export function DeviceCard({ d }: { d: DeviceStatus }) {
  const cc = chartColors()
  return (
    <div className="glass-card flex flex-col px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: d.online ? cc.green : "var(--accent-amber)" }}
          />
          <div>
            <div className="text-sm font-semibold text-ink">{d.name}</div>
            <div className="mono text-[10px] text-ink-faint">{d.host}</div>
          </div>
        </div>
        {d.url && (
          <a
            href={d.url}
            target="_blank"
            rel="noreferrer"
            className="mono text-[10px] text-ink-soft transition-colors hover:text-ink"
          >
            open ↗
          </a>
        )}
      </div>

      {d.online ? (
        <div className="flex flex-col gap-2.5">
          <Metric
            label="CPU"
            pct={d.cpuPercent}
            text={d.cpuPercent != null ? `${d.cpuPercent.toFixed(1)}%` : "—"}
            color={cc.violet}
          />
          <Metric
            label="Memory"
            pct={d.memPercent}
            text={
              d.memUsed != null && d.memTotal
                ? `${(d.memUsed / 1e9).toFixed(1)} / ${(d.memTotal / 1e9).toFixed(0)} GB`
                : "—"
            }
            color={cc.green}
          />
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] text-ink-faint">temperature</span>
            <span className="mono text-[10px] text-ink-soft">
              {d.temperatureC != null ? `${d.temperatureC.toFixed(0)}°C` : "—"}
            </span>
          </div>
        </div>
      ) : (
        <div className="mono py-2 text-center text-[10px] text-ink-faint">
          offline
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  pct,
  text,
  color,
}: {
  label: string
  pct: number | null
  text: string
  color: string
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span className="mono text-[10px] text-ink-faint">{label}</span>
        <span className="mono text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>
          {text}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(100, pct ?? 0)}%`, background: color } as CSSProperties}
        />
      </div>
    </div>
  )
}
