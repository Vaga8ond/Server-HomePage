import { useState, type ReactNode } from "react"
import { Play, RotateCw, Square } from "lucide"
import { MorphIcon } from "morphicons/react"

import { controlContainer, type ContainerAction } from "@/lib/api"

export function ContainerControls({
  name,
  running,
  onControl,
  spread,
}: {
  name: string
  running: boolean
  onControl?: () => void
  /** "spread": buttons grow to fill the row (action-bar style, container cards). */
  spread?: boolean
}) {
  const [pending, setPending] = useState<ContainerAction | null>(null)

  async function act(action: ContainerAction) {
    setPending(action)
    try {
      await controlContainer(name, action)
    } finally {
      setPending(null)
      onControl?.()
    }
  }

  const busy = pending !== null
  const grow = spread ? "flex-1 justify-center" : ""

  return (
    <div className={spread ? "flex flex-1 gap-1.5" : "flex gap-1.5"}>
      {running ? (
        <>
          <Btn
            icon={<MorphIcon icon={RotateCw} size={12} />}
            color="#F59E0B"
            label="Restart"
            busy={busy}
            className={grow}
            onClick={() => act("restart")}
          />
          <Btn
            icon={<MorphIcon icon={Square} size={12} />}
            color="#EF4444"
            label="Stop"
            busy={busy}
            className={grow}
            onClick={() => act("stop")}
          />
        </>
      ) : (
        <Btn
          icon={<MorphIcon icon={Play} size={12} />}
          color="#22C55E"
          label="Start"
          busy={busy}
          className={grow}
          onClick={() => act("start")}
        />
      )}
    </div>
  )
}

function Btn({
  icon,
  color,
  label,
  busy,
  className,
  onClick,
}: {
  icon: ReactNode
  color: string
  label: string
  busy: boolean
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      title={label}
      className={`inline-flex items-center gap-1 rounded-[7px] border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 disabled:opacity-50 ${className ?? ""}`}
      style={{ background: `${color}1a`, color, borderColor: `${color}33` }}
    >
      {icon}
      {label}
    </button>
  )
}
