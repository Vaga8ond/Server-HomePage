import { useState, type CSSProperties } from "react"
import { HardDrive, Radio, Wifi } from "lucide"
import { MorphIcon } from "morphicons/react"

import { NetworkAreaChart } from "@/components/dashboard/charts/network-area-chart"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionTitle } from "@/components/dashboard/section-title"
import { StatCard } from "@/components/dashboard/stat-card"
import { StatusBadge } from "@/components/dashboard/status-badge"
import {
  fetchHistory,
  fetchHost,
  fetchNetwork,
  fetchServices,
  type ApiService,
  type HistorySeries,
  type HistoryWindow,
  type HostMetrics,
  type NetInterface,
} from "@/lib/api"
import { formatBytes, formatNumber } from "@/lib/format"
import { usePoll } from "@/lib/use-poll"

export function NetworkView() {
  const { data: host } = usePoll<HostMetrics>(fetchHost, 5000)
  const { data: net } = usePoll(fetchNetwork, 15_000)
  const { data: services } = usePoll<ApiService[]>(fetchServices, 10_000)
  const [win, setWin] = useState<HistoryWindow>("24h")
  const { data: hist, loading } = usePoll<HistorySeries>(() => fetchHistory(win), 60_000)

  const ifaces = net?.interfaces ?? []
  const rx = host?.network?.rxBytesPerSec
  const tx = host?.network?.txBytesPerSec

  return (
    <>
      <PageHeader
        title="Network"
        subtitle="Interfaces · Connections · Bandwidth · Service Ports"
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Inbound"
          value={rx != null ? `${(rx / 1e6).toFixed(1)}` : "—"}
          sub="RX MB/s · live"
          color="var(--accent-cyan)"
        />
        <StatCard
          label="Outbound"
          value={tx != null ? `${(tx / 1e6).toFixed(1)}` : "—"}
          sub="TX MB/s · live"
          color="var(--accent-violet)"
        />
        <StatCard
          label="Connections"
          value={formatNumber(host?.tcpConnections)}
          sub="TCP active"
          color="var(--accent-green)"
        />
        <StatCard
          label="Link Speed"
          value={host?.netMaxMbps ? `${host.netMaxMbps}` : "—"}
          sub={net?.defaultInterface ? `${net.defaultInterface} · Mbps` : "default route"}
          color="var(--accent-amber)"
        />
      </div>

      <div className="mb-8">
        <SectionTitle>Bandwidth</SectionTitle>
        <NetworkAreaChart
          points={hist?.points ?? []}
          window={win}
          onWindow={setWin}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div>
          <SectionTitle>Interfaces</SectionTitle>
          <div className="flex flex-col gap-3">
            {ifaces.length === 0 ? (
              <div className="glass-card px-5 py-8 text-center text-xs text-ink-faint">
                no interfaces detected
              </div>
            ) : (
              ifaces.map((iface) => <IfaceCard key={iface.name} iface={iface} />)
            )}
          </div>
        </div>

        <div>
          <SectionTitle>Service Ports</SectionTitle>
          <div className="glass-card overflow-hidden p-0">
            <div className="grid grid-cols-[1fr_90px_70px] border-b border-line px-5 py-2.5">
              {["Service", "Status", "Port"].map((h) => (
                <span
                  key={h}
                  className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint"
                >
                  {h}
                </span>
              ))}
            </div>
            {(services ?? []).map((s, i, arr) => (
              <div
                key={s.id}
                className={`grid grid-cols-[1fr_90px_70px] items-center px-5 py-3 ${
                  i === arr.length - 1 ? "" : "border-b border-line"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-ink">{s.name}</div>
                  <div className="mono text-[9px] text-ink-faint">{s.category}</div>
                </div>
                <StatusBadge status={s.status} />
                <span className="mono text-xs text-ink-soft">:{s.port}</span>
              </div>
            ))}
            {services && services.length === 0 && (
              <div className="px-5 py-8 text-center text-xs text-ink-faint">no services</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function IfaceCard({ iface }: { iface: NetInterface }) {
  const up = iface.state === "up"
  return (
    <div className="glass-card px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-[9px] border"
            style={{
              background: up ? "rgba(0,229,255,0.1)" : "rgba(107,114,128,0.1)",
              borderColor: up ? "rgba(0,229,255,0.2)" : "rgba(107,114,128,0.2)",
            } as CSSProperties}
          >
            {iface.name === "lo" ? (
              <MorphIcon icon={Radio} size={14} color="currentColor" className="text-ink-faint" />
            ) : iface.name.startsWith("wl") || iface.name.startsWith("wlan") ? (
              <MorphIcon icon={Wifi} size={14} color={up ? "var(--accent-cyan)" : "currentColor"} className="text-ink-faint" />
            ) : (
              <MorphIcon icon={HardDrive} size={14} color={up ? "var(--accent-cyan)" : "currentColor"} className="text-ink-faint" />
            )}
          </span>
          <span className="mono text-sm font-bold text-ink">{iface.name}</span>
          <span className="mono rounded bg-ink/5 px-1.5 py-px text-[10px] text-ink-faint">
            {iface.state}
          </span>
        </div>
        {iface.speedMbps != null && (
          <span className="mono text-[10px] text-ink-faint">{iface.speedMbps} Mb/s</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: "IP",
            value: iface.addresses.length > 0 ? iface.addresses.join(", ") : "—",
          },
          {
            label: "RX total",
            value: iface.rxBytes != null ? formatBytes(iface.rxBytes) : "—",
          },
          {
            label: "TX total",
            value: iface.txBytes != null ? formatBytes(iface.txBytes) : "—",
          },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-ink/[0.03] px-2.5 py-2">
            <div className="mb-0.5 text-[9px] uppercase tracking-[0.06em] text-ink-faint">
              {s.label}
            </div>
            <div className="mono truncate text-xs font-medium text-ink" title={s.value}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
