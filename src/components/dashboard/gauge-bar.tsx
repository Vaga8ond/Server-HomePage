import type { IconNode } from "lucide"
import { MorphIcon } from "morphicons/react"
import type { CSSProperties } from "react"

export function GaugeBar({
  label,
  value,
  unit,
  max,
  percent,
  color,
  icon,
}: {
  label: string
  value: string
  unit: string
  max: string
  percent: number
  color: string
  icon: IconNode
}) {
  const pct = Math.min(100, Math.max(0, percent))

  return (
    <div className="glass-card p-[20px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MorphIcon icon={icon} size={18} color={color} />
          <span className="text-[13px] font-medium text-ink-soft">{label}</span>
        </div>
        <span className="mono text-[22px] font-bold tracking-[-0.02em] text-ink">
          {value}
          <span className="ml-0.5 text-[13px] font-normal text-ink-soft">{unit}</span>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={
            {
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${color}88, ${color})`,
              boxShadow: `0 0 8px ${color}60`,
            } as CSSProperties
          }
        />
      </div>

      <div className="mt-1.5 flex justify-between">
        <span className="mono text-[10px] text-ink-faint">0</span>
        <span className="mono text-[10px] text-ink-faint">{pct.toFixed(0)}%</span>
        <span className="mono text-[10px] text-ink-faint">
          {max}
          {unit}
        </span>
      </div>
    </div>
  )
}
