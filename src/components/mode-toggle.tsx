import { Moon, Sun } from "lucide" // icon *data* for morphicons, not components
import { MorphIcon } from "morphicons/react"


export function ModeToggle({
  isDark,
  onToggle,
}: {
  isDark: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle dark / light theme"
      title="Toggle theme"
      className="flex size-9 items-center justify-center rounded-[10px] border border-line bg-glass text-base text-ink-soft transition-colors duration-150 hover:text-ink"
    >
      {/* sun ↔ moon morph with spring physics (rotation emerges from the math) */}
      <MorphIcon icon={isDark ? Sun : Moon} size={16} color="currentColor" />
    </button>
  )
}
