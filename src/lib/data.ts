import {
  Boxes,
  Database,
  Globe,
  Zap,
  type LucideIcon,
} from "lucide-react"
import type { IconNode } from "lucide"
import {
  Boxes as BoxesNode,
  Database as DatabaseNode,
  Globe as GlobeNode,
  Zap as ZapNode,
} from "lucide"

export interface NavItem {
  label: string
  id: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", id: "overview", icon: Globe },
  { label: "Services", id: "services", icon: Boxes },
  { label: "Monitoring", id: "monitoring", icon: Zap },
  { label: "Storage", id: "storage", icon: Database },
  { label: "Network", id: "network", icon: Globe },
  { label: "Logs", id: "logs", icon: Boxes },
]

export type GaugeKey = "cpu" | "memory" | "disk" | "network"

export interface GaugeDef {
  key: GaugeKey
  label: string
  color: string
  icon: IconNode
}

export const GAUGE_DEFS: GaugeDef[] = [
  { key: "cpu", label: "CPU", color: "#00E5FF", icon: ZapNode },
  { key: "memory", label: "Memory", color: "#A855F7", icon: BoxesNode },
  { key: "disk", label: "Disk", color: "#22C55E", icon: DatabaseNode },
  { key: "network", label: "Network", color: "#F59E0B", icon: GlobeNode },
]

export type StatKey = "load" | "processes" | "connections" | "temperature"

export interface StatDef {
  key: StatKey
  label: string
  color: string
}

export const STAT_DEFS: StatDef[] = [
  { key: "load", label: "Load Avg", color: "#00E5FF" },
  { key: "processes", label: "Processes", color: "#A855F7" },
  { key: "connections", label: "Connections", color: "#22C55E" },
  { key: "temperature", label: "Temperature", color: "#F59E0B" },
]
