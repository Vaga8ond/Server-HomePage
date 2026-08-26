import { useState, type CSSProperties } from "react"
import { AnimatePresence, motion } from "motion/react"
import { FileText, X } from "lucide"
import { MorphIcon } from "morphicons/react"

import { ContainerControls } from "@/components/dashboard/container-controls"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { fetchContainerLogs, fetchContainers, type ContainerInfo } from "@/lib/api"
import { containerColor, getServiceIcon, imageToIconKey } from "@/lib/icons"
import { formatBytes } from "@/lib/format"
import { usePoll } from "@/lib/use-poll"

export function ContainersView() {
  const { data, loading, refetch } = usePoll<ContainerInfo[]>(fetchContainers, 5000)
  const list = data ?? []
  const running = list.filter((c) => c.state === "running").length
  const stopped = list.length - running

  const [logName, setLogName] = useState<string | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  const [logBusy, setLogBusy] = useState(false)

  async function openLogs(name: string) {
    setLogName(name)
    setLogText(null)
    setLogBusy(true)
    try {
      setLogText(await fetchContainerLogs(name))
    } catch {
      setLogText(null)
    } finally {
      setLogBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Monitoring"
        subtitle={`${list.length} containers · ${running} running · ${stopped} stopped`}
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
        {loading && list.length === 0 ? (
          <span className="mono text-xs text-ink-faint">loading…</span>
        ) : (
          list.map((c) => (
            <ContainerCard key={c.id} c={c} refetch={refetch} onLogs={openLogs} />
          ))
        )}
      </div>

      <AnimatePresence>
        {logName && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setLogName(null)}
        >
          <motion.div
            className="glass-card flex max-h-[72vh] w-full max-w-3xl flex-col overflow-hidden"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            style={{ background: "var(--bg-elevated)" } as CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <span className="mono text-xs font-semibold text-ink">
                logs · {logName} <span className="font-normal text-ink-faint">· last 200</span>
              </span>
              <button
                type="button"
                onClick={() => setLogName(null)}
                className="flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/10 hover:text-ink"
              >
                <MorphIcon icon={X} size={16} />
              </button>
            </div>
            <pre className="mono flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 text-xs leading-relaxed text-ink-soft">
              {logBusy ? "loading…" : logText && logText.length > 0 ? logText : "(no output)"}
            </pre>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Docker container rendered with the Figma service-card form:
 *  42px icon chip + status badge / name / `image · ports` mono sub / footer
 *  (mem + cpu on the left, Logs + controls on the right). */
function ContainerCard({
  c,
  refetch,
  onLogs,
}: {
  c: ContainerInfo
  refetch: () => void
  onLogs: (name: string) => void
}) {
  const color = containerColor(c.state)
  const Icon = getServiceIcon(imageToIconKey(c.image))
  const isRunning = c.state === "running"
  const status = isRunning ? "running" : c.state === "dead" ? "error" : "stopped"

  return (
    <div
      className="glass-card svc-card group p-5"
      style={{ "--svc": color } as CSSProperties}
    >
      <div className="mb-3.5 flex items-start justify-between">
        <span
          className="flex size-[42px] items-center justify-center rounded-xl border"
          style={{ background: `${color}18`, borderColor: `${color}30` }}
        >
          <MorphIcon icon={Icon} size={20} color={color} />
        </span>
        <StatusBadge status={status} />
      </div>

      <div className="mb-4">
        <div className="truncate text-[15px] font-semibold text-ink" title={c.name}>
          {c.name}
        </div>
        <div className="mono mt-1 truncate text-xs text-ink-faint" title={c.image}>
          {shortImage(c.image)} {c.ports.length > 0 && `· ${c.ports[0]}`}
        </div>
      </div>

      {/* mini gauges — Figma gauge-bar form factor */}
      <div className="mb-4 space-y-2">
        <MiniBar
          label="CPU"
          value={c.cpuPercent}
          display={c.cpuPercent != null ? `${c.cpuPercent.toFixed(1)}%` : "—"}
        />
        <MiniBar
          label="MEM"
          value={c.memPercent}
          display={c.memUsage != null ? formatBytes(c.memUsage) : "—"}
        />
      </div>

      {/* footer: full-width action bar (Logs + controls), equal segments —
          mem/state already shown by the gauges and badge above. */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onLogs(c.name)}
          title="View logs"
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-[7px] border border-line px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:text-ink"
        >
          <MorphIcon icon={FileText} size={12} />
          Logs
        </button>
        <ContainerControls
          spread
          name={c.name}
          running={isRunning}
          onControl={refetch}
        />
      </div>
    </div>
  )
}

function MiniBar({
  label,
  value,
  display,
}: {
  label: string
  value: number | null
  display: string
}) {
  const pct = value == null ? 0 : Math.min(100, value)
  return (
    <div className="flex items-center gap-2">
      <span className="mono w-7 text-[10px] text-ink-faint">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-cyan-glow transition-[width] duration-500"
          style={{ width: `${pct}%` } as CSSProperties}
        />
      </div>
      <span className="mono w-14 text-right text-[10px] text-ink-soft">{display}</span>
    </div>
  )
}

/** "ghcr.io/immich-app/immich-server:v3.1.0" → "immich-server:v3.1.0".
 *  Strips the registry host (first segment with a dot/port), then keeps the
 *  last path segment — repo + tag is what identifies a card at a glance. */
function shortImage(image: string): string {
  const parts = image.split("/")
  const hasRegistry =
    parts.length > 1 &&
    (parts[0] === "localhost" || parts[0].includes(".") || parts[0].includes(":"))
  const path = hasRegistry ? parts.slice(1) : parts
  const last = path[path.length - 1] ?? image
  return last.length > 28 ? `${last.slice(0, 26)}…` : last
}
