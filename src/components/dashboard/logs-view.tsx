import { useEffect, useMemo, useRef, useState } from "react"
import { Radio, RefreshCw, Search } from "lucide"
import { MorphIcon } from "morphicons/react"

import { PageHeader } from "@/components/dashboard/page-header"
import { SkeletonLogRows } from "@/components/dashboard/skeleton"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  fetchComposeProjects,
  fetchContainerLogs,
  fetchContainers,
  getToken,
  type ComposeProject,
  type ContainerInfo,
} from "@/lib/api"
import { usePoll } from "@/lib/use-poll"

type Level = "ERROR" | "WARN" | "INFO" | "DEBUG"
const LEVELS: (Level | "ALL")[] = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"]

/** Ring-buffer cap — live mode keeps memory bounded at ~5000 lines. */
const MAX_LINES = 5000

/** Per-container line colors for merged view — mirrors backend AUTO_COLORS. */
const MERGED_COLORS = ["#00E5FF", "#A855F7", "#22C55E", "#F59E0B", "#3B82F6"]

interface LogRow {
  raw: string
  src?: string // container name in merged mode
}

function appendLine(prev: LogRow[] | null, raw: string, src?: string): LogRow[] {
  const next = prev ? [...prev, { raw, src }] : [{ raw, src }]
  return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
}

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
  src?: string
}

function parseLine(raw: string): LogLine {
  // Docker's default driver prefixes each line with an RFC3339 timestamp
  // (when it isn't stripped) — peel it off for the time column.
  let ts: string | null = null
  let text = raw
  const m = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z?)\s?/.exec(raw)
  if (m) {
    // RFC3339Nano → "MM-DD HH:MM:SS" (drop year, fractional seconds, zone)
    ts = m[1].replace("T", " ").slice(5, 19)
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
  const [lines, setLines] = useState<LogRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Level | "ALL">("ALL")
  const [search, setSearch] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [tail, setTail] = useState(500)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  type Range = "all" | "1h" | "24h" | "custom"
  const [range, setRange] = useState<Range>("all")
  const [draftFrom, setDraftFrom] = useState("")
  const [draftTo, setDraftTo] = useState("")
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null)
  const [mode, setMode] = useState<"single" | "merged">("single")
  const [project, setProject] = useState<string | null>(null)
  const [mergedContainers, setMergedContainers] = useState<string[]>([])
  const [visible, setVisible] = useState<Set<string>>(new Set()) // empty = all

  const { data: projects } = usePoll<ComposeProject[]>(fetchComposeProjects, 10_000)
  const [live, setLive] = useState(false)
  const [follow, setFollow] = useState(true)
  const [stream, setStream] = useState<"off" | "connecting" | "open" | "error">("off")
  const [newCount, setNewCount] = useState(0)
  const followRef = useRef(true)
  followRef.current = follow
  const isLiveView = live || mode === "merged"

  const name =
    selected ?? list.find((c) => c.state === "running")?.name ?? list[0]?.name ?? null

  const { parsed, filtered, errors, warns } = useMemo(() => {
    const parsed = (lines ?? []).map((l) => ({ ...parseLine(l.raw), src: l.src }))
    let errors = 0, warns = 0
    for (const l of parsed) {
      if (l.level === "ERROR") errors++
      else if (l.level === "WARN") warns++
    }
    const q = search.toLowerCase()
    const filtered = parsed.filter(
      (l) =>
        (filter === "ALL" || l.level === filter) &&
        (q === "" || l.text.toLowerCase().includes(q)) &&
        (mode === "single" || !l.src || visible.size === 0 || visible.has(l.src)),
    )
    return { parsed, filtered, errors, warns }
  }, [lines, filter, search, mode, visible])

  useEffect(() => {
    if (mode !== "single" || !name) return // merged streams instead of snapshotting
    let alive = true
    setBusy(true)
    const spec =
      range === "all"
        ? undefined
        : range === "custom"
          ? applied
            ? { kind: "custom" as const, from: applied.from, to: applied.to }
            : undefined // custom picked but not applied yet → plain tail fetch
          : { kind: range }
    fetchContainerLogs(name, tail, spec)
      .then((text) =>
        alive &&
        setLines(
          text
            .split("\n")
            .filter(Boolean)
            .map((raw) => ({ raw })),
        ),
      )
      .catch(() => alive && setLines(null))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [name, tail, refreshKey, live, range, applied])

  // Live mode (single): docker streams the last `tail` lines immediately, then follows
  // — no separate snapshot fetch needed. The SSE `line` events just append.
  useEffect(() => {
    if (live !== true || mode !== "single" || !name) return
    let es: EventSource | null = null
    setLines(null)
    setStream("connecting")
    es = new EventSource(
      `/api/containers/${encodeURIComponent(name)}/logs/stream?tail=${tail}&token=${encodeURIComponent(getToken())}`,
    )
    es.addEventListener("open", () => setStream("open"))
    es.addEventListener("line", (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string }
      setLines((prev) => appendLine(prev, line))
      if (!followRef.current) setNewCount((c) => c + 1)
    })
    es.onerror = () => setStream("error") // EventSource auto-reconnects
    return () => {
      es?.close()
      setStream("off")
    }
  }, [live, mode, name, tail])

  // Merged mode: whole compose project streams live (no snapshot variant).
  useEffect(() => {
    if (mode !== "merged" || !project) return
    let es: EventSource | null = null
    setLines(null)
    setStream("connecting")
    setFollow(true)
    es = new EventSource(
      `/api/logs/merged?project=${encodeURIComponent(project)}&tail=${tail}&token=${encodeURIComponent(getToken())}`,
    )
    es.addEventListener("open", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { containers: string[] }
      setMergedContainers(d.containers)
      setVisible(new Set()) // all visible on (re)connect
      setStream("open")
    })
    es.addEventListener("line", (e) => {
      const { name: src, line } = JSON.parse((e as MessageEvent).data) as {
        name: string
        line: string
      }
      setLines((prev) => appendLine(prev, line, src))
      if (!followRef.current) setNewCount((c) => c + 1)
    })
    es.onerror = () => setStream("error") // EventSource auto-reconnects
    return () => {
      es?.close()
      setStream("off")
    }
  }, [mode, project, tail])

  // Entering merged mode with no project yet → default to the first one.
  useEffect(() => {
    if (mode === "merged" && !project && projects?.length) {
      setProject(projects[0].project)
    }
  }, [mode, project, projects])

  // Fresh snapshot (or following live) → pin the newest entries at the bottom.
  useEffect(() => {
    if (!follow) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, follow])

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  function toggleContainer(src: string) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.size === 0) {
        // "all visible" → clicking one chip isolates: add every other, drop this
        for (const c of mergedContainers) if (c !== src) next.add(c)
      } else if (next.has(src)) {
        next.delete(src)
        if (next.size === mergedContainers.length - 1) return new Set() // back to all
      } else {
        next.add(src)
      }
      return next
    })
  }

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (atBottom && !follow) {
      setFollow(true)
      setNewCount(0)
    } else if (!atBottom && follow) {
      setFollow(false)
    }
  }

  function toggleLive() {
    if (live) {
      setLive(false)
      setRefreshKey((k) => k + 1)
    } else {
      setLive(true)
      setNewCount(0)
      setFollow(true)
    }
  }

  function jumpToLatest() {
    setFollow(true)
    setNewCount(0)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle={`docker container logs · ${mode === "merged" ? `project ${project ?? "…"} · ${mergedContainers.length} containers` : (name ?? "no containers")} · ${parsed.length}${parsed.length >= MAX_LINES ? " (capped)" : ""} lines${isLiveView ? ` · ${stream}` : ""}`}
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

      {/* container selector (single) / project selector (merged) */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {mode === "merged"
          ? (projects ?? []).map((p) => (
              <button
                key={p.project}
                type="button"
                onClick={() => setProject(p.project)}
                className={`mono rounded-full border px-3 py-1 text-[11px] transition-colors ${
                  p.project === project
                    ? "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow"
                    : "border-line text-ink-faint hover:text-ink"
                }`}
              >
                {p.project}
                <span className="ml-1 text-ink-faint">·{p.containers.length}</span>
              </button>
            ))
          : (
            <>
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
            </>
          )}
      </div>

      {/* log stream */}
      <div className="glass-card relative overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-[18px] py-3">
          <div className="flex gap-1">
            {(["single", "merged"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (m === mode) return
                  setMode(m)
                  setLive(false)
                  if (m === "single") setRefreshKey((k) => k + 1)
                }}
                className={`mono rounded-md border px-2 py-1 text-[10px] font-semibold uppercase transition-colors ${
                  mode === m
                    ? "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow"
                    : "border-transparent text-ink-faint hover:text-ink"
                }`}
                title={m === "merged" ? "Stream all containers of a compose project" : "One container at a time"}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="relative max-w-64 flex-1">
            <MorphIcon icon={Search} size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
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
          {mode === "merged" &&
            mergedContainers.map((c) => {
              const on = visible.size === 0 || visible.has(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleContainer(c)}
                  className={`mono flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    on ? "border-line text-ink-soft" : "border-transparent text-ink-faint line-through"
                  }`}
                  title={on ? "Hide this container" : "Show this container"}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: MERGED_COLORS[Math.max(0, mergedContainers.indexOf(c)) % MERGED_COLORS.length], opacity: on ? 1 : 0.35 }}
                  />
                  {c}
                </button>
              )
            })}
          {!isLiveView && (
            <div className="flex gap-1">
              {(["all", "1h", "24h", "custom"] as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`mono rounded-md border px-2 py-1 text-[10px] font-semibold uppercase transition-colors ${
                    range === r
                      ? "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow"
                      : "border-transparent text-ink-faint hover:text-ink"
                  }`}
                >
                  {r === "all" ? "all" : r === "custom" ? "custom" : r}
                </button>
              ))}
            </div>
          )}
          {mode === "single" && !isLiveView && range === "custom" ? (
            <div className="flex items-center gap-1.5">
              <input
                type="datetime-local"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                aria-label="From"
                className="mono rounded-md border border-line bg-ink/5 px-1.5 py-1 text-[10px] text-ink-soft outline-none"
                style={{ colorScheme: "dark" }}
              />
              <span className="text-[10px] text-ink-faint">→</span>
              <input
                type="datetime-local"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                aria-label="To"
                className="mono rounded-md border border-line bg-ink/5 px-1.5 py-1 text-[10px] text-ink-soft outline-none"
                style={{ colorScheme: "dark" }}
              />
              <button
                type="button"
                onClick={() => setApplied(draftFrom ? { from: new Date(draftFrom).toISOString(), to: draftTo ? new Date(draftTo).toISOString() : new Date().toISOString() } : null)}
                className="mono rounded-md border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-1 text-[10px] font-semibold text-cyan-glow"
              >
                apply
              </button>
            </div>
          ) : null}
          {live ? (
            <span
              className={`mono flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] uppercase ${
                stream === "open" ? "border-line text-ink-soft" : "text-ink-faint"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${stream === "open" ? "animate-pulse" : ""}`}
                style={{
                  background:
                    stream === "open" ? "var(--accent-green)" : stream === "error" ? "var(--accent-red)" : "var(--accent-amber)",
                }}
              />
              live {stream}
            </span>
          ) : (
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              aria-label="Lines to load"
              className="mono rounded-md border border-line bg-ink/5 px-1.5 py-1 text-[10px] text-ink-soft outline-none"
              style={{ colorScheme: "dark" }}
            >
              {[200, 500, 1000, 2000].map((n) => (
                <option key={n} value={n}>
                  {n} lines
                </option>
              ))}
            </select>
          )}
          {mode === "single" && (
            <button
              type="button"
              onClick={toggleLive}
              aria-label={live ? "Stop live tail" : "Start live tail"}
              className={`mono flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase transition-colors ${
                live
                  ? "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow"
                  : "border-line text-ink-faint hover:text-ink"
              }`}
              title={live ? "Stop live tail" : "Stream logs in real time"}
            >
              <MorphIcon icon={Radio} size={12} />
              {live ? "stop" : "live"}
            </button>
          )}
          {mode === "single" && !live && (
            <button
              type="button"
              onClick={refresh}
              aria-label="Refresh logs"
              className="flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/10 hover:text-ink"
              title="Refresh"
            >
              <MorphIcon icon={RefreshCw} size={14} className={busy ? "animate-spin" : ""} />
            </button>
          )}
          <span className="mono text-[10px] text-ink-faint">{filtered.length} entries</span>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="relative max-h-[440px] overflow-y-auto">
          {busy && lines == null ? (
            <SkeletonLogRows rows={10} />
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
                  className={`grid ${l.src ? "grid-cols-[86px_52px_120px_1fr]" : "grid-cols-[86px_52px_1fr]"} items-start gap-2 px-[18px] py-2 [contain-intrinsic-size:auto_36px] [content-visibility:auto] ${
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
                  {l.src && (
                    <span
                      className="mono truncate pt-px text-[10px]"
                      style={{ color: MERGED_COLORS[Math.max(0, mergedContainers.indexOf(l.src)) % MERGED_COLORS.length] }}
                      title={l.src}
                    >
                      {l.src}
                    </span>
                  )}
                  <span className="mono break-all text-[11px] leading-relaxed text-ink-soft">
                    {l.text}
                  </span>
                </div>
              )
            })
          )}
        </div>
        {isLiveView && !follow && newCount > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 mono rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-[10px] font-semibold text-cyan-glow shadow-lg backdrop-blur"
          >
            ↓ {newCount} new — jump to latest
          </button>
        )}
      </div>
    </>
  )
}
