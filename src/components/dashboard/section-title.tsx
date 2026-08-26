import type { ReactNode } from "react"


export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h2
      className={`mb-[18px] text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft ${className ?? ""}`}
    >
      {children}
    </h2>
  )
}
