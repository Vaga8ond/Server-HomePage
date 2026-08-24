import { useEffect, useMemo, useState } from "react"
import { RefreshCw, Search } from "lucide-react"

import { PageHeader } from "@/components/dashboard/page-header"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  fetchContainerLogs,
  fetchContainers,
  type ContainerInfo,
} from "@/lib/api"
import { usePoll } from "@/lib/use-poll"

type Level = "ERROR" | "WARN" | "INFO" | "DEBUG"
const LEVELS: (Level | "ALL")[] = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"]

const LEVEL_STYLE: Record<Level, { color: string; bg: string }> = {
  ERROR: { color: "var(--accent-red)", bg: "rgba(239,68,68,0.12)" },
  WARN: { color: "var(--accent-amber)", bg: "rgba(245,158,11,0.12)" },
  INFO: { color: "var(--accent-cyan)", bg: "rgba(0,229,255,0.1)" },
  DEBUG: { color: "var(--accent-violet)", bg: "rgba(168,85,247,0.1)" },
}

interface LogLine {
  ts: string | null
  level: Level
  text: string
}

function parseLine(raw: string): LogLine {
  // Docker's default driver prefixes each line with an RFC3339 timestamp
  // (when it isn't stripped) — peel it off for the time column.
  let ts: string | null = null
  let text = raw
  const m = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z?)\s?/.exec(raw)
  if (m) {
    ts = m[1].replace("T", " ").slice(5, -1) // "MM-DD HH:MM:SS"
    text = raw.slice(m[0].length)
  }
  const lm = /\b(FATAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE|NOTICE)\b/i.exec(text)
  let level: Level = "INFO"
  if (lm) {
    const w = lm[1].toUpperCase()
    if (w === "FATAL" || w === "ERROR" || w === "ERR") level = "ERROR"
    else if (w.startsWith("WARN") || w === "NOTICE") level = "WARN"
    else if (w === "TRACE" || w === "DEBUG") level = "DEBUG"
  }
  return { ts, level, text }
}

export function LogsView() {
  const { data: containers } = usePoll<ContainerInfo[]>(fetchContainers, 10_000)
  const list = containers ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [lines, setLines] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Level | "ALL">("ALL")
  const [search, setSearch] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  const name =
    selected ?? list.find((c) => c.state === "running")?.name ?? list[0]?.name ?? null

  useEffect(() => {
    if (!name) return
    let alive = true
    setBusy(true)
    fetchContainerLogs(name)
      .then((text) => alive && setLines(text.split("\n").filter(Boolean)))
      .catch(() => alive && setLines(null))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [name, refreshKey])

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  const { parsed, filtered, errors, warns } = useMemo(() => {
    const parsed = (lines ?? []).map(parseLine)
    let errors = 0, warns = 0
    for (const l of parsed) {
      if (l.level === "ERROR") errors++
      else if (l.level === "WARN") warns++
    }
    const q = search.toLowerCase()
    const filtered = parsed.filter(
      (l) =>
        (filter === "ALL" || l.level === filter) &&
        (q === "" || l.text.toLowerCase().includes(q)),
    )
    return { parsed, filtered, errors, warns }
  }, [lines, filter, search])

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle={`docker container logs · ${name ?? "no containers"} · last 200 lines`}
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Lines Loaded"
          value={String(parsed.length)}
          sub={name ?? "—"}
          color="var(--accent-cyan)"
        />
        <StatCard label="Errors" value={String(errors)} sub="in loaded window" color="var(--accent-red)" />
        <StatCard label="Warnings" value={String(warns)} sub="in loaded window" color="var(--accent-amber)" />
        <StatCard
          label="Containers"
          value={String(list.length)}
          sub={`${list.filter((c) => c.state === "running").length} running`}
          color="var(--accent-green)"
        />
      </div>

      {/* container selector */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {list.length === 0 && (
          <span className="mono text-xs text-ink-faint">no containers found…</span>
        )}
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelected(c.name)}
            className={`mono rounded-full border px-3 py-1 text-[11px] transition-colors ${
              c.name === name
                ? "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow"
                : "border-line text-ink-faint hover:text-ink"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* log stream */}
      <div className="glass-card overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3">
          <div className="relative max-w-64 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter logs…"
              className="mono w-full rounded-lg border border-line bg-ink/5 py-1.5 pl-8 pr-3 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-cyan-glow/40"
            />
          </div>
          <div className="flex gap-1">
            {LEVELS.map((lvl) => {
              const active = filter === lvl
              const st = lvl === "ALL" ? null : LEVEL_STYLE[lvl]
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setFilter(lvl)}
                  className={`mono rounded-md border px-2 py-1 text-[10px] font-semibold uppercase transition-colors ${
                    active ? "border-ink/15" : "border-transparent text-ink-faint"
                  }`}
                  style={
                    active && st
                      ? { background: st.bg, color: st.color }
                      : active
                        ? { background: "rgba(127,127,127,0.12)", color: "var(--text-primary)" }
                        : undefined
                  }
                >
                  {lvl}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/10 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
          <span className="mono text-[10px] text-ink-faint">{filtered.length} entries</span>
        </div>

        <div className="max-h-[440px] overflow-y-auto">
          {busy && lines == null ? (
            <div className="px-[18px] py-8 text-center text-xs text-ink-faint">loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-xs text-ink-faint">
              {parsed.length === 0 ? "(no output)" : "no matching entries"}
            </div>
          ) : (
            filtered.map((l, i) => {
              const st = LEVEL_STYLE[l.level]
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[86px_52px_1fr] items-start gap-2 px-[18px] py-2 ${
                    i < filtered.length - 1 ? "border-b border-ink/[0.04]" : ""
                  }`}
                  style={l.level === "ERROR" ? { background: "rgba(239,68,68,0.03)" } : undefined}
                >
                  <span className="mono pt-px text-[10px] text-ink-faint">{l.ts ?? "—"}</span>
                  <span
                    className="mono w-fit rounded-md border px-1.5 py-0.5 text-center text-[9px] font-bold"
                    style={{ color: st.color, background: st.bg, borderColor: st.color }}
                  >
                    {l.level}
                  </span>
                  <span className="mono break-all text-[11px] leading-relaxed text-ink-soft">
                    {l.text}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
