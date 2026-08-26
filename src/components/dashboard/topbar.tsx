import { TriangleAlert } from "lucide"
import { MorphIcon } from "morphicons/react"

import { LiveClock } from "@/components/dashboard/live-clock"
import { ModeToggle } from "@/components/mode-toggle"
import type { ApiService } from "@/lib/api"

export function Topbar({
  services,
  isDark,
  onToggleTheme,
  online,
}: {
  services: ApiService[]
  isDark: boolean
  onToggleTheme: () => void
  online: boolean
}) {
  const running = services.filter((s) => s.status === "running").length
  const errors = services.filter((s) => s.status === "error").length

  return (
    <header className="topbar">
      <div className="flex items-center gap-4 px-7 py-3.5">
        {/* Status indicators */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-full border border-green-glow/20 bg-green-glow/10 px-3 py-1.5">
            <span className="pulse inline-block size-1.5 rounded-full bg-green-glow shadow-[0_0_6px_#22C55E]" />
            <span className="mono text-xs font-semibold text-green-glow">
              {running} up
            </span>
          </div>

          {errors > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-red-glow/20 bg-red-glow/10 px-3 py-1.5">
              <span className="mono text-xs font-semibold text-red-glow">
                {errors} err
              </span>
            </div>
          )}

          {!online && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-glow/20 bg-amber-glow/10 px-3 py-1.5">
              <MorphIcon icon={TriangleAlert} size={12} className="text-amber-glow" />
              <span className="mono text-xs font-semibold text-amber-glow">
                reconnecting
              </span>
            </div>
          )}

          <LiveClock />
        </div>

        <ModeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>
    </header>
  )
}
