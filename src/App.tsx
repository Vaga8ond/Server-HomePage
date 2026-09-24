import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

import { OverviewView } from "@/components/dashboard/overview-view"
import { ServicesView } from "@/components/dashboard/services-view"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Topbar } from "@/components/dashboard/topbar"

// Heavy views load on demand — overview/services stay eager for first paint.
const ContainersView = lazy(() =>
  import("@/components/dashboard/containers-view").then((m) => ({ default: m.ContainersView })),
)
const DesignView = lazy(() =>
  import("@/components/dashboard/design-view").then((m) => ({ default: m.DesignView })),
)
const LogsView = lazy(() =>
  import("@/components/dashboard/logs-view").then((m) => ({ default: m.LogsView })),
)
const NetworkView = lazy(() =>
  import("@/components/dashboard/network-view").then((m) => ({ default: m.NetworkView })),
)
const StorageView = lazy(() =>
  import("@/components/dashboard/storage-view").then((m) => ({ default: m.StorageView })),
)
import { fetchServices, type ApiService } from "@/lib/api"
import { NAV_ITEMS } from "@/lib/data"
import { usePoll } from "@/lib/use-poll"
import { useTheme } from "@/lib/use-theme"

export default function App() {
  const { isDark, toggle } = useTheme()
  const [activeNav, setActiveNav, dir] = useHashRoute()
  const { data: services, error, loading, refetch } = usePoll(fetchServices, 5000)
  const serviceList = services ?? []

  return (
    <div className="min-h-svh bg-canvas">
      <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />

      <div className="layout">
        <Topbar
          services={serviceList}
          isDark={isDark}
          onToggleTheme={toggle}
          online={!error}
        />

        <main className="flex-1 px-7 pb-12 pt-7">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={activeNav}
              custom={dir}
              variants={PAGE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.25, 1, 0.35, 1] }}
            >
              {renderView(activeNav, serviceList, loading, refetch)}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

/** URL-hash-backed nav route (#/services etc.) — survives refresh and
 *  back/forward. Unknown/empty hashes fall back to "overview". */
const ROUTE_ORDER = NAV_ITEMS.map((n) => n.id)

/** Direction-aware hash nav: returns [route, navigate, direction] where
 *  direction is +1 (forward) / -1 (back) by sidebar order, so page
 *  transitions slide the right way — including browser back/forward. */
function useHashRoute(): [string, (id: string) => void, 1 | -1] {
  const read = () => location.hash.replace(/^#\/?/, "") || "overview"
  const [route, setRoute] = useState(read)
  const lastRef = useRef(route)
  const [dir, setDir] = useState<1 | -1>(1)

  const apply = useCallback((next: string) => {
    const cur = lastRef.current
    if (cur === next) return
    const delta = ROUTE_ORDER.indexOf(next) - ROUTE_ORDER.indexOf(cur)
    setDir(delta >= 0 ? 1 : -1)
    lastRef.current = next
    setRoute(next)
  }, [])

  const navigate = useCallback(
    (id: string) => {
      location.hash = `/${id}`
      apply(id)
    },
    [apply],
  )

  useEffect(() => {
    const onHash = () => apply(read())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [apply])

  return [route, navigate, dir]
}

const PAGE_VARIANTS = {
  enter: (d: 1 | -1) => ({ opacity: 0, x: 14 * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: 1 | -1) => ({ opacity: 0, x: -14 * d }),
}

function renderView(
  activeNav: string,
  services: ApiService[],
  loading: boolean,
  onControl: () => void,
) {
  switch (activeNav) {
    case "services":
      return (
        <ServicesView
          services={services}
          loading={loading}
          onControl={onControl}
        />
      )
    case "monitoring":
    case "storage":
    case "network":
    case "logs":
    case "design":
      // Lazy views — Suspense inside the moving container so the page
      // transition plays while the chunk streams in (LAN: near-instant).
      return (
        <Suspense fallback={null}>
          {activeNav === "monitoring" && <ContainersView />}
          {activeNav === "storage" && <StorageView />}
          {activeNav === "network" && <NetworkView />}
          {activeNav === "logs" && <LogsView />}
          {activeNav === "design" && <DesignView />}
        </Suspense>
      )
    default:
      return <OverviewView />
  }
}
