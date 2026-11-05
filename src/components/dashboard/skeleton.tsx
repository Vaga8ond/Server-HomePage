import { motion, type Variants } from "motion/react"

/* Skeleton loading placeholders — layout-shaped so views never jump when real
 * data replaces them (Plan A: skeleton → staggered content fade-in). */

/** Shimmer placeholder block. Size/shape via className (e.g. "h-4 w-2/3"). */
export function Sk({ className = "" }: { className?: string }) {
  return <div className={`sk ${className}`} />
}

/** Card skeleton matching the ServiceCard/ContainerCard glass-card form:
 *  42px icon chip + status pill / two text lines / metric bar zone /
 *  footer (status text + action buttons) — sized so real cards (~230px)
 *  replace it without a row jump. */
export function SkeletonCard() {
  return (
    <div className="glass-card svc-card min-h-[232px] p-5">
      <div className="mb-3.5 flex items-start justify-between">
        <Sk className="size-[42px] rounded-xl" />
        <Sk className="h-5 w-16 rounded-full" />
      </div>
      <div className="mb-4">
        <Sk className="mb-1 h-4 w-2/3 rounded" />
        <Sk className="h-3 w-1/2 rounded" />
      </div>
      {/* metric zone — approximates ServiceCard availability bar and
       *  ContainerCard CPU/MEM mini gauges alike */}
      <div className="mb-3.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <Sk className="h-2.5 w-16 rounded" />
          <Sk className="h-2.5 w-8 rounded" />
        </div>
        <Sk className="h-2 w-full rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <Sk className="h-3 w-10 rounded" />
        <div className="flex gap-2">
          <Sk className="h-[26px] w-16 rounded-lg" />
          <Sk className="h-[26px] w-14 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** KPI skeleton matching KpiCard: label / sparkline / big value row. */
export function SkeletonKpi() {
  return (
    <div className="glass-card flex min-h-[154px] flex-1 flex-col p-[22px]">
      <Sk className="mb-2.5 h-3 w-24 rounded" />
      <Sk className="mb-3 h-9 w-full rounded" />
      <div className="mt-auto flex items-baseline gap-1.5">
        <Sk className="h-8 w-16 rounded" />
        <Sk className="h-3 w-9 rounded" />
      </div>
    </div>
  )
}

/** Wide panel skeleton matching the glass metric charts (title + plot area
 *  ~230px, the loaded chart plot height, so the swap doesn't reflow). */
export function SkeletonPanel({ className = "" }: { className?: string }) {
  return (
    <div className={`glass-card px-[22px] pb-4 pt-[22px] ${className}`}>
      <Sk className="mb-1.5 h-4 w-28 rounded" />
      <Sk className="mb-4 h-3 w-20 rounded" />
      <Sk className="h-[230px] w-full rounded-lg" />
    </div>
  )
}

/** Log-line skeletons matching the logs grid rows (time / level / message). */
export function SkeletonLogRows({ rows = 10 }: { rows?: number }) {
  const widths = ["w-[72%]", "w-[45%]", "w-[86%]", "w-[58%]"]
  return (
    <div aria-hidden className="px-[18px] py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[86px_52px_1fr] items-center gap-2 py-[10px]"
        >
          <Sk className="h-4 w-[70px]" />
          <Sk className="h-4 w-9" />
          <Sk className={`h-4 ${widths[i % widths.length]}`} />
        </div>
      ))}
    </div>
  )
}

/* Staggered content entrance — cards fade/rise in 60 ms apart after the
 * skeleton swaps out. One-shot per mount; later polls don't re-trigger. */

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 1, 0.35, 1] } },
}

/** Grid wrapper that staggers its StaggerItem children on mount. */
export function StaggerGrid({
  className = "",
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div className={className} variants={gridVariants} initial="hidden" animate="show">
      {children}
    </motion.div>
  )
}

/** Per-card entrance. Use className="grid" when wrapping a card that should
 *  stretch to equal row height like it did as a direct grid item. */
export function StaggerItem({
  className = "",
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  )
}
