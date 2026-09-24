import { Palette } from "lucide"
import { MorphIcon } from "morphicons/react"

import { NAV_ITEMS } from "@/lib/data"
import { fetchServices, type ApiService } from "@/lib/api"
import { usePoll } from "@/lib/use-poll"

export function Sidebar({
  activeNav,
  onNavChange,
}: {
  activeNav: string
  onNavChange: (id: string) => void
}) {
  // Slow poll — only for the down-services badge on the Services nav item.
  const { data: services } = usePoll<ApiService[]>(fetchServices, 10_000)
  const down = services?.filter((s) => s.status !== "running").length ?? 0

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="brand border-b border-line px-5 pb-5 pt-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-[34px] items-center justify-center rounded-[10px] bg-gradient-to-br from-cyan-glow to-violet-glow shadow-[0_0_16px_rgba(0,229,255,0.3)]">
            <span className="size-2.5 rotate-45 rounded-[2px] bg-white" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-[-0.01em] text-ink">HomeBase</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-2 px-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Navigation
        </div>
        {NAV_ITEMS.map((item) => {
          return (
            <div
              key={item.id}
              className={`nav-item ${activeNav === item.id ? "active" : ""}`}
              onClick={() => onNavChange(item.id)}
            >
              <MorphIcon icon={item.icon} size={14} />
              {item.label}
              {item.id === "services" && down > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
                  {down}
                </span>
              )}
            </div>
          )
        })}

        <div className="mb-2 mt-5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Resources
        </div>
        <div
          className={`nav-item ${activeNav === "design" ? "active" : ""}`}
          onClick={() => onNavChange("design")}
        >
          <MorphIcon icon={Palette} size={14} />
          Design
        </div>
      </nav>
    </aside>
  )
}
