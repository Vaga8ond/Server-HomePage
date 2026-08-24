import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import { ArrowUpRight } from "lucide-react"

import { PageHeader } from "@/components/dashboard/page-header"
import { getServiceIcon } from "@/lib/icons"

interface DesignEntry {
  name: string
  url: string
  iconKey: string
  color: string
}

/** Card for a static design resource — same Figma service-card form factor,
 *  minus the status/footer (external links have nothing to probe). */
function ResourceCard({ entry }: { entry: DesignEntry }) {
  const Icon = getServiceIcon(entry.iconKey)
  const host = new URL(entry.url).hostname.replace(/^www\./, "")
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noreferrer"
      className="glass-card svc-card group block p-5"
      style={{ "--svc": entry.color } as CSSProperties}
    >
      <div className="mb-3.5 flex items-start justify-between">
        <span
          className="flex size-[42px] items-center justify-center rounded-xl border"
          style={{
            background: `${entry.color}18`,
            borderColor: `${entry.color}30`,
          }}
        >
          <Icon className="size-5" style={{ color: entry.color } as CSSProperties} />
        </span>
        <ArrowUpRight className="size-4 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <div className="mb-4">
        <div className="text-[15px] font-semibold text-ink">{entry.name}</div>
        <div className="mono mt-1 truncate text-xs text-ink-faint">{host}</div>
      </div>
      <span className="text-[11px] text-ink-soft">design resource</span>
    </a>
  )
}

/** Design sub-route under Resources: static link cards fed by
 *  public/design-resources.json (edit that file, not code). */
export function DesignView() {
  const [categories, setCategories] = useState<
    { name: string; entries: DesignEntry[] }[]
  >([])

  useEffect(() => {
    fetch("/design-resources.json")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]))
  }, [])

  const total = categories.reduce((s, c) => s + c.entries.length, 0)

  return (
    <>
      <PageHeader
        title="Design"
        subtitle={
          total > 0
            ? `${total} design resources · ${categories.map((c) => c.name).join(" · ")}`
            : "loading…"
        }
      />

      {categories.map((cat) => (
        <section key={cat.name} className="mb-8">
          <h2 className="mb-[18px] text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {cat.name}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {cat.entries.map((e) => (
              <ResourceCard key={e.url} entry={e} />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
