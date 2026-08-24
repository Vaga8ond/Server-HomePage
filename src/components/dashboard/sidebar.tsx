import { Palette } from "lucide-react"

import { NAV_ITEMS } from "@/lib/data"
import { fetchHost } from "@/lib/api"
import { usePoll } from "@/lib/use-poll"
import { cn } from "@/lib/utils"

export function Sidebar({
  activeNav,
  onNavChange,
}: {
  activeNav: string
  onNavChange: (id: string) => void
}) {
  // Slow poll just for the host identity shown in the footer.
  const { data: host } = usePoll(fetchHost, 30_000)
  const hostname = host?.hostInfo?.hostname ?? "connecting…"

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="border-b border-line px-5 pb-5 pt-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-[34px] items-center justify-center rounded-[10px] bg-gradient-to-br from-cyan-glow to-violet-glow shadow-[0_0_16px_rgba(0,229,255,0.3)]">
            <span className="size-2.5 rotate-45 rounded-[2px] bg-white" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-[-0.01em] text-ink">HomeBase</div>
            <div className="mono text-[10px] text-ink-faint">v2.4.1</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-2 px-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Navigation
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.id}
              className={cn("nav-item", activeNav === item.id && "active")}
              onClick={() => onNavChange(item.id)}
            >
              <Icon className="size-[14px]" />
              {item.label}
            </div>
          )
        })}

        <div className="mb-2 mt-5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Resources
        </div>
        <div
          className={cn("nav-item", activeNav === "design" && "active")}
          onClick={() => onNavChange("design")}
        >
          <Palette className="size-[14px]" />
          Design
        </div>
      </nav>

      {/* User footer */}
      <div className="border-t border-line px-3 py-3.5">
        <div className="glass-card-sm flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex size-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-violet-glow to-cyan-glow text-xs font-bold text-white">
            AD
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink">admin</div>
            <div className="mono text-[10px] text-ink-faint">root@{hostname}</div>
          </div>
          <span className="size-[7px] shrink-0 rounded-full bg-green-glow shadow-[0_0_6px_#22C55E]" />
        </div>
      </div>
    </aside>
  )
}
