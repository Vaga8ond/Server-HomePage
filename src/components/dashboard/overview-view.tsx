import { useEffect, useState } from "react"

import { GaugeBar } from "@/components/dashboard/gauge-bar"
import { DeviceCard } from "@/components/dashboard/device-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { chartColors } from "@/components/dashboard/charts/chart-tooltip"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionTitle } from "@/components/dashboard/section-title"
import { StatCard } from "@/components/dashboard/stat-card"
import { DiskDonutChart } from "@/components/dashboard/charts/disk-donut-chart"
import { NetworkAreaChart } from "@/components/dashboard/charts/network-area-chart"
import { TrafficHeatmap } from "@/components/dashboard/charts/traffic-heatmap"
import { WeeklyBarChart } from "@/components/dashboard/charts/weekly-bar-chart"
import { GAUGE_DEFS, STAT_DEFS, type GaugeKey, type StatKey } from "@/lib/data"
import {
  fetchDevices,
  fetchHistory,
  fetchHistoryAggregate,
  fetchHost,
  type DeviceStatus,
  type HistoryAggregate,
  type HistoryPoint,
  type HistorySeries,
  type HistoryWindow,
  type HostMetrics,
} from "@/lib/api"
import { usePoll } from "@/lib/use-poll"
import { formatDuration, formatNumber } from "@/lib/format"

export function OverviewView() {
  const { data: host } = usePoll<HostMetrics>(fetchHost, 5000)
  const { data: devices } = usePoll<DeviceStatus[]>(fetchDevices, 5000)
  const sub = host?.hostInfo
    ? `homeserver · ${host.hostInfo.hostname ?? "?"} · ${host.hostInfo.os ?? ""}`.replace(/ · $/, "")
    : "homeserver"

  // History charts: Prometheus-free, fed by the backend recorder.
  const [win, setWin] = useState<HistoryWindow>("24h")
  const {
    data: hist,
    loading: histLoading,
    refetch: refetchHist,
  } = usePoll<HistorySeries>(() => fetchHistory(win), 60_000)
  const { data: agg } = usePoll<HistoryAggregate>(fetchHistoryAggregate, 60_000)

  // KPI cards always show a 24h window, independent of the chart toggle.
  const { data: kpiHist } = usePoll<HistorySeries>(() => fetchHistory("24h"), 60_000)
  const kp = kpiHist?.points ?? []

  /** Downsampled last-24h values for the KPI sparkline (≤~120 pts). */
  function sparkOf(pick: (p: HistoryPoint) => number | null): (number | null)[] | undefined {
    if (kp.length < 2) return undefined
    const all = kp.map(pick)
    if (!all.some((v) => v != null)) return undefined
    const step = Math.max(1, Math.ceil(all.length / 120))
    return all.filter((_, i) => i % step === 0)
  }

  /** Percent change vs 24h ago (mean of first vs last few samples). Needs ≥20h
   *  of data, otherwise null → the badge stays hidden while history accumulates. */
  function deltaOf(pick: (p: HistoryPoint) => number | null): number | null {
    if (kp.length < 8) return null
    // Measure span on real data (buckets exist for the whole window even when
    // the recorder only started hours ago — bucket stamps would always pass).
    let first = -1
    let last = -1
    kp.forEach((p, i) => {
      if (pick(p) != null) {
        if (first < 0) first = i
        last = i
      }
    })
    if (first < 0 || kp[last].t - kp[first].t < 20 * 3_600_000) return null
    const vals = kp.map(pick).filter((v): v is number => v != null)
    if (vals.length < 8) return null
    const head = avg(vals.slice(0, 4))
    const tail = avg(vals.slice(-4))
    if (head <= 0) return null
    return ((tail - head) / head) * 100
  }

  const netOf = (p: HistoryPoint) =>
    p.rx != null || p.tx != null ? ((p.rx ?? 0) + (p.tx ?? 0)) / 1e6 : null

  useEffect(() => {
    refetchHist() // window switch → immediate refetch
  }, [win, refetchHist])

  const cc = chartColors()
  const kpis = [
    {
      label: "Network I/O",
      value: host?.network
        ? ((host.network.rxBytesPerSec + host.network.txBytesPerSec) / 1e6).toFixed(1)
        : "—",
      unit: "MB/s",
      color: cc.cyan,
      spark: sparkOf(netOf),
      delta: deltaOf(netOf),
    },
    {
      label: "CPU",
      value: host?.cpu ? host.cpu.percent.toFixed(1) : "—",
      unit: "%",
      color: cc.violet,
      spark: sparkOf((p) => p.cpu),
      delta: deltaOf((p) => p.cpu),
    },
    {
      label: "Memory",
      value: host?.memory ? host.memory.percent.toFixed(0) : "—",
      unit: "%",
      color: cc.green,
      spark: sparkOf((p) => p.mem),
      delta: deltaOf((p) => p.mem),
    },
    {
      label: "Uptime",
      value: host?.uptimeSeconds ? formatDuration(host.uptimeSeconds) : "—",
      unit: "",
    },
  ]

  return (
    <>
      <PageHeader title="Overview" subtitle={sub} />

      {/* KPI row */}
      <div className="mb-7 flex flex-wrap gap-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* External devices (NAS etc.) — hidden when devices.json is empty */}
      {devices && devices.length > 0 && (
        <div className="mb-7">
          <SectionTitle>Devices</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {devices.map((d) => (
              <DeviceCard key={d.id} d={d} />
            ))}
          </div>
        </div>
      )}

      {/* Storage + history placeholder */}
      <div className="mb-8">
        <SectionTitle>Metrics</SectionTitle>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_2fr]">
          <div className="glass-card flex flex-col px-[22px] pb-3 pt-[22px]">
            <div className="mb-3.5">
              <div className="mb-0.5 text-sm font-semibold text-ink">Disk Usage</div>
              <div className="mono text-[11px] text-ink-faint">root filesystem</div>
            </div>
            <DiskDonutChart
              used={host?.disk?.used ?? 0}
              total={host?.disk?.total ?? 0}
            />
          </div>
          <NetworkAreaChart
            points={hist?.points ?? []}
            window={win}
            onWindow={setWin}
            loading={histLoading}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <WeeklyBarChart weekly={agg?.weekly ?? []} />
          <TrafficHeatmap heatmap={agg?.heatmap ?? []} maxMbps={agg?.maxMbps ?? 0} />
        </div>
      </div>

      {/* System monitor */}
      <div>
        <SectionTitle>System Monitor</SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {GAUGE_DEFS.map((def) => (
            <GaugeBar
              key={def.key}
              label={def.label}
              color={def.color}
              icon={def.icon}
              {...gaugeFor(host, def.key)}
            />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STAT_DEFS.map((def) => (
            <StatCard
              key={def.key}
              label={def.label}
              color={def.color}
              {...statFor(host, def.key)}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function gaugeFor(host: HostMetrics | null, key: GaugeKey) {
  switch (key) {
    case "cpu":
      return {
        value: host?.cpu ? host.cpu.percent.toFixed(1) : "—",
        unit: "%",
        max: "100",
        percent: host?.cpu?.percent ?? 0,
      }
    case "memory": {
      const m = host?.memory
      return {
        value: m ? (m.used / 1e9).toFixed(1) : "—",
        unit: " GB",
        max: m ? (m.total / 1e9).toFixed(0) : "—",
        percent: m?.percent ?? 0,
      }
    }
    case "disk": {
      const d = host?.disk
      return {
        value: d ? (d.used / 1e9).toFixed(0) : "—",
        unit: " GB",
        max: d ? (d.total / 1e9).toFixed(0) : "—",
        percent: d?.percent ?? 0,
      }
    }
    case "network": {
      const n = host?.network
      const mbps = n ? (n.rxBytesPerSec + n.txBytesPerSec) / 1e6 : 0
      // Scale to the NIC's real link speed (reported by the backend); fall
      // back to gigabit assumption when unknown.
      const maxMBps = (host?.netMaxMbps ?? 1000) / 8
      return {
        value: n ? mbps.toFixed(1) : "—",
        unit: " MB/s",
        max: maxMBps.toFixed(0),
        percent: Math.min(100, (mbps / maxMBps) * 100),
      }
    }
  }
}

function statFor(host: HostMetrics | null, key: StatKey) {
  switch (key) {
    case "load":
      return {
        value: host?.load ? host.load.one.toFixed(2) : "—",
        sub: host?.load
          ? `${host.load.one} / ${host.load.five} / ${host.load.fifteen} (1/5/15m)`
          : "1m / 5m / 15m",
      }
    case "processes":
      return {
        value: formatNumber(host?.processes),
        sub: "running",
      }
    case "connections":
      return {
        value: formatNumber(host?.tcpConnections),
        sub: "TCP active",
      }
    case "temperature":
      return {
        value:
          host?.temperatureC != null ? `${host.temperatureC.toFixed(0)}°C` : "—",
        sub: "hottest zone",
      }
  }
}
