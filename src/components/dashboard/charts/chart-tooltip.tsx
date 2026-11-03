import type { CSSProperties } from "react"

export interface TooltipItem {
  name: string
  value: string
  color: string
}

/** Glass tooltip shared by the recharts-based history charts. */
export function ChartTooltip({ title, items }: { title: string; items: TooltipItem[] }) {
  return (
    <div
      className="glass-card-sm px-3.5 py-2.5"
      style={{ background: "var(--bg-elevated)" } as CSSProperties}
    >
      <div className="mono mb-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((it) => (
          <div key={it.name} className="flex items-center gap-2 text-xs">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: it.color }} />
            <span className="text-ink-soft">{it.name}</span>
            <span className="mono ml-auto pl-4 font-medium text-ink">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Chart stroke/grid colors resolved per theme (recharts needs concrete colors). */
export function chartColors() {
  const dark = document.documentElement.classList.contains("dark")
  return {
    cyan: dark ? "#00e5ff" : "#0891b2",
    violet: dark ? "#a855f7" : "#7c3aed",
    green: dark ? "#22c55e" : "#16a34a",
    orange: dark ? "#f59e0b" : "#d97706",
    grid: dark ? "rgba(255,255,255,0.07)" : "rgba(10,12,30,0.07)",
    tick: dark ? "rgba(255,255,255,0.3)" : "rgba(10,12,30,0.32)",
  }
}
