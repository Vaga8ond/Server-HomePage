export interface KpiCardProps {
  label: string
  value: string
  unit: string
  /** Sparkline stroke/fill color (theme-resolved hex). */
  color?: string
  /** Last-24h series for the mini chart; nulls are bridged. */
  spark?: (number | null)[]
  /** Percent change vs 24h ago; null renders nothing (still accumulating). */
  delta?: number | null
}

/** Hand-rolled sparkline — replaced the recharts <AreaChart> so recharts is
 *  no longer pulled into the main bundle (charts lazy-load elsewhere). */
function Sparkline({ values, color, gid }: { values: (number | null)[]; color?: string; gid: string }) {
  const n = values.length
  if (n < 2) return null
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  // 36px viewBox, 2px vertical padding; nulls bridge from the last real value
  // (matches the old chart's connectNulls).
  const yOf = (v: number) => 34 - ((v - min) / span) * 30
  let last = nums[0]
  const d = values
    .map((v, i) => {
      if (v != null) last = v
      return `${i === 0 ? "M" : "L"} ${((i / (n - 1)) * 100).toFixed(2)} ${yOf(last).toFixed(2)}`
    })
    .join(" ")
  return (
    <svg
      viewBox="0 0 100 36"
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={`${d} L 100 36 L 0 36 Z`} fill={`url(#${gid})`} stroke="none" />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function KpiCard({ label, value, unit, color, spark, delta }: KpiCardProps) {
  const hasSpark = !!spark && spark.length > 1 && spark.some((v) => v != null)
  const gid = `kpi-${label.replace(/\W+/g, "")}`
  const up = (delta ?? 0) >= 0

  return (
    <div className="glass-card flex flex-1 flex-col p-[22px]">
      <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.04em] text-ink-soft">
        {label}
      </div>
      {hasSpark && (
        <div className="mb-3 h-9">
          <Sparkline values={spark!} color={color} gid={gid} />
        </div>
      )}
      <div className="mt-auto flex items-baseline gap-1.5">
        <span className="mono text-4xl font-bold leading-none tracking-[-0.02em] text-ink">
          {value}
        </span>
        {unit && <span className="text-sm font-medium text-ink-soft">{unit}</span>}
        {delta != null && (
          <span
            className="mono ml-auto pl-2 text-[11px] font-semibold"
            style={{ color: up ? "#22C55E" : "#EF4444" }}
          >
            {up ? "↑ +" : "↓ −"}
            {Math.abs(delta).toFixed(1)}%
            <span className="ml-1 font-normal text-ink-faint">vs 24h</span>
          </span>
        )}
      </div>
    </div>
  )
}
