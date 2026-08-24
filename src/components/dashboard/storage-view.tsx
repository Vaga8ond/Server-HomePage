import type { CSSProperties } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { DiskDonutChart } from "@/components/dashboard/charts/disk-donut-chart"
import { ChartTooltip, chartColors } from "@/components/dashboard/charts/chart-tooltip"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionTitle } from "@/components/dashboard/section-title"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  fetchHistory,
  fetchStorage,
  type HistorySeries,
  type StorageMount,
} from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { usePoll } from "@/lib/use-poll"

export function StorageView() {
  const { data: storage } = usePoll(fetchStorage, 15_000)
  const { data: hist } = usePoll<HistorySeries>(() => fetchHistory("24h"), 60_000)
  const mounts = storage?.mounts ?? []

  // Sum unique devices only — bind mounts of the same fs would double-count.
  const byDevice = new Map(mounts.map((m) => [m.device, m]))
  const devices = [...byDevice.values()]
  const total = devices.reduce((s, m) => s + m.total, 0)
  const used = devices.reduce((s, m) => s + m.used, 0)
  const free = devices.reduce((s, m) => s + m.free, 0)
  const root = mounts.find((m) => m.mount === "/") ?? devices[0]

  const cc = chartColors()
  const diskSeries = (hist?.points ?? [])
    .filter((p) => p.disk != null)
    .map((p) => ({ t: p.t, disk: p.disk as number }))

  return (
    <>
      <PageHeader
        title="Storage"
        subtitle={
          mounts.length > 0
            ? `${devices.length} filesystems · ${mounts.length} mounts · ${((used / total) * 100).toFixed(0)}% used`
            : "loading…"
        }
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Capacity"
          value={total ? formatBytes(total) : "—"}
          sub={`${devices.length} filesystems`}
          color={cc.cyan}
        />
        <StatCard
          label="Used Space"
          value={used ? formatBytes(used) : "—"}
          sub={total ? `${((used / total) * 100).toFixed(0)}% utilization` : ""}
          color={cc.violet}
        />
        <StatCard
          label="Free Space"
          value={free ? formatBytes(free) : "—"}
          sub="available"
          color={cc.green}
        />
        <StatCard
          label="Root Filesystem"
          value={root ? `${root.percent.toFixed(0)}%` : "—"}
          sub={root ? `${formatBytes(root.used)} / ${formatBytes(root.total)}` : ""}
          color={"var(--accent-amber)"}
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_2fr]">
        <div className="glass-card flex flex-col px-[22px] pb-3 pt-[22px]">
          <div className="mb-3.5">
            <div className="mb-0.5 text-sm font-semibold text-ink">Disk Usage</div>
            <div className="mono text-[11px] text-ink-faint">
              {root ? root.device : "root filesystem"}
            </div>
          </div>
          <DiskDonutChart used={root?.used ?? 0} total={root?.total ?? 0} />
        </div>

        <div className="glass-card flex flex-col px-[22px] pb-4 pt-[22px]">
          <div className="mb-3.5">
            <div className="mb-0.5 text-sm font-semibold text-ink">Disk Usage Over Time</div>
            <div className="mono text-[11px] text-ink-faint">% used · root filesystem · last 24h</div>
          </div>
          {diskSeries.length < 2 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
              accumulating history…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={diskSeries} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="diskG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cc.cyan} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={cc.cyan} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t: number) =>
                    `${String(new Date(t).getHours()).padStart(2, "0")}:00`
                  }
                  tick={{ fontSize: 9, fill: cc.tick, fontFamily: "JetBrains Mono" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={48}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 9, fill: cc.tick, fontFamily: "JetBrains Mono" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as { t: number; disk: number }
                    return (
                      <ChartTooltip
                        title={new Date(p.t).toLocaleString()}
                        items={[{ name: "Disk used", value: `${p.disk.toFixed(1)}%`, color: cc.cyan }]}
                      />
                    )
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="disk"
                  name="Disk used"
                  stroke={cc.cyan}
                  strokeWidth={2}
                  fill="url(#diskG)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <SectionTitle>Filesystem Mounts</SectionTitle>
      <div className="glass-card overflow-hidden p-0">
        {mounts.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-faint">no mounts detected</div>
        ) : (
          mounts.map((m, i) => <MountRow key={`${m.device}${m.mount}`} m={m} last={i === mounts.length - 1} />)
        )}
      </div>
    </>
  )
}

function MountRow({ m, last }: { m: StorageMount; last: boolean }) {
  const warn = m.percent > 85
  const color = warn ? "var(--accent-amber)" : "var(--accent-cyan)"
  return (
    <div
      className={`grid grid-cols-[1fr_64px_1.4fr] items-center gap-3 px-5 py-3.5 ${
        last ? "" : "border-b border-line"
      }`}
    >
      <div className="min-w-0">
        <div className="mono truncate text-xs font-semibold text-ink" title={m.mount}>
          {m.mount}
        </div>
        <div className="mono mt-0.5 truncate text-[9px] text-ink-faint" title={m.device}>
          {m.device}
        </div>
      </div>
      <span className="mono w-fit rounded-md bg-ink/5 px-2 py-0.5 text-[10px] text-ink-soft">
        {m.fstype}
      </span>
      <div>
        <div className="mb-1 flex justify-between">
          <span className="mono text-[10px] text-ink-faint">
            {formatBytes(m.used)} / {formatBytes(m.total)}
          </span>
          <span
            className="mono text-[10px] font-semibold"
            style={{ color: warn ? "var(--accent-amber)" : "var(--text-muted)" }}
          >
            {m.percent.toFixed(0)}%
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${m.percent}%`, background: color } as CSSProperties}
          />
        </div>
      </div>
    </div>
  )
}
