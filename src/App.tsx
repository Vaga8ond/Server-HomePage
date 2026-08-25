import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

import { ContainersView } from "@/components/dashboard/containers-view"
import { DesignView } from "@/components/dashboard/design-view"
import { LogsView } from "@/components/dashboard/logs-view"
import { NetworkView } from "@/components/dashboard/network-view"
import { OverviewView } from "@/components/dashboard/overview-view"
import { ServicesView } from "@/components/dashboard/services-view"
import { StorageView } from "@/components/dashboard/storage-view"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Topbar } from "@/components/dashboard/topbar"
import { fetchServices, type ApiService } from "@/lib/api"
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
const ROUTE_ORDER = ["overview", "services", "monitoring", "storage", "network", "logs", "design"]

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
      return <ContainersView />
    case "storage":
      return <StorageView />
    case "network":
      return <NetworkView />
    case "logs":
      return <LogsView />
    case "design":
      return <DesignView />
    case "overview":
      return <OverviewView />
    default:
      return <OverviewView />
  }
}
