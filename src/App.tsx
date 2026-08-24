import { useCallback, useEffect, useState } from "react"

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
  const [activeNav, setActiveNav] = useHashRoute()
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
          <div key={activeNav} className="view-enter">
            {renderView(activeNav, serviceList, loading, refetch)}
          </div>
        </main>
      </div>
    </div>
  )
}

/** URL-hash-backed nav route (#/services etc.) — survives refresh and
 *  back/forward. Unknown/empty hashes fall back to "overview". */
function useHashRoute(): [string, (id: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, "") || "overview"
  const [route, setRoute] = useState(read)

  const navigate = useCallback((id: string) => {
    location.hash = `/${id}`
    setRoute(id)
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  return [route, navigate]
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
