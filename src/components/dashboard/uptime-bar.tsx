import type { ServiceUptime } from "@/lib/api"

const TIME_FMT = new Intl.DateTimeFormat([], {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

const COLOR_UP = "#34d399"
const COLOR_PARTIAL = "#fbbf24"
const COLOR_DOWN = "#f87171"
const COLOR_UNKNOWN = "rgba(148, 163, 184, 0.18)"

/** Render cap: 96 raw buckets × min-width + gaps overflow a 220px card
 *  (min content ~180px). Merged pairwise — worst ratio wins, latencies avg. */
const MAX_SEGMENTS = 48

interface Segment {
  t: number
  ratio: number | null
  latencyMs: number | null
}

function segmentize(cells: ServiceUptime["cells"]): Segment[] {
  if (cells.length <= MAX_SEGMENTS) return cells
  const size = Math.ceil(cells.length / MAX_SEGMENTS)
  const out: Segment[] = []
  for (let i = 0; i < cells.length; i += size) {
    const chunk = cells.slice(i, i + size)
    const probed = chunk.filter((c) => c.ratio != null)
    const lats = chunk
      .map((c) => c.latencyMs)
      .filter((v): v is number => v != null)
    out.push({
      t: chunk[0].t,
      // worst case wins: any failure in the segment shows as degraded
      ratio: probed.length ? Math.min(...probed.map((c) => c.ratio!)) : null,
      latencyMs: lats.length
        ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length)
        : null,
    })
  }
  return out
}

/** GitHub-style availability strip: one cell per bucket, colored by the
 *  fraction of probes that answered "running" inside it. Hover shows the
 *  window start time, success ratio and mean answered latency. */
export function UptimeBar({ uptime }: { uptime: ServiceUptime }) {
  const segments = segmentize(uptime.cells)
  return (
    <div
      className="flex h-3.5 w-full gap-px overflow-hidden"
      role="img"
      aria-label={`availability ${
        uptime.uptimePct != null ? `${uptime.uptimePct.toFixed(1)}%` : "no data"
      }`}
    >
      {segments.map((c) => {
        const color =
          c.ratio == null
            ? COLOR_UNKNOWN
            : c.ratio >= 0.999
              ? COLOR_UP
              : c.ratio > 0
                ? COLOR_PARTIAL
                : COLOR_DOWN
        const title =
          c.ratio == null
            ? `${TIME_FMT.format(c.t)} · no data`
            : `${TIME_FMT.format(c.t)} · ${(c.ratio * 100).toFixed(0)}%${
                c.latencyMs != null ? ` · ${c.latencyMs}ms` : ""
              }`
        return (
          <span
            key={c.t}
            title={title}
            className="min-w-[2px] flex-1 rounded-[2px] transition-transform hover:scale-y-125"
            style={{ background: color }}
          />
        )
      })}
    </div>
  )
}
