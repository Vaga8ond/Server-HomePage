import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  Box,
  CalendarDays,
  Camera,
  Cloud,
  Code2,
  Container,
  Cpu,
  Database,
  Download,
  FileText,
  Film,
  Gamepad2,
  Gauge,
  GitBranch,
  Globe,
  HardDrive,
  Image,
  Images,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  Music,
  NotebookPen,
  PenTool,
  Rss,
  Search,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  SquareKanban,
  Terminal,
  Users,
  Video,
  Wallet,
  Zap,
} from "lucide"
// same icon names as before, but raw IconNode data — morphicons consumes
// these directly instead of lucide-react components
import type { IconNode } from "lucide"

/** iconKey → lucide icon. Unknown keys fall back to Container. Keep in sync
 *  with the list in README.md (服务目录 · iconKey). */
export const SERVICE_ICONS: Record<string, IconNode> = {
  // Media & content
  images: Images,
  image: Image,
  film: Film,
  video: Video,
  music: Music,
  camera: Camera,
  "book-open": BookOpen,
  gamepad: Gamepad2,
  "file-text": FileText,
  pen: PenTool,
  notebook: NotebookPen,
  // Infra & compute
  container: Container,
  server: Server,
  database: Database,
  "hard-drive": HardDrive,
  cloud: Cloud,
  cpu: Cpu,
  layers: Layers,
  box: Box,
  gauge: Gauge,
  activity: Activity,
  zap: Zap,
  // Network & web
  globe: Globe,
  link: Link2,
  download: Download,
  rss: Rss,
  search: Search,
  mail: Mail,
  "message-circle": MessageCircle,
  bell: Bell,
  // Dev tools
  code: Code2,
  git: GitBranch,
  terminal: Terminal,
  // Security
  shield: Shield,
  key: KeyRound,
  lock: Lock,
  // Misc / existing catalog
  sparkles: Sparkles,
  kanban: SquareKanban,
  bot: Bot,
  settings: Settings,
  users: Users,
  calendar: CalendarDays,
  cart: ShoppingCart,
  wallet: Wallet,
}

export function getServiceIcon(iconKey: string): IconNode {
  return SERVICE_ICONS[iconKey] ?? Container
}

/** Figma service-card aesthetic, applied to raw docker images: infer an
 *  iconKey from the image name (e.g. "ghcr.io/immich-app/immich-server:v3"
 *  → "images"). Unknown images fall back to Container. */
const IMAGE_HINTS: [RegExp, string][] = [
  [/immich|photo|plex|jellyfin|emby|navidrome/, "images"],
  [/postgres|mysql|mariadb|mongo/, "database"],
  [/redis|valkey|memcach/, "zap"],
  [/nginx|traefik|caddy/, "globe"],
  [/prometheus|grafana|zabbix/, "gauge"],
  [/git|gitea|forgejo/, "git"],
  [/qemu|kvm|pve|proxmox/, "cpu"],
  [/torrent|transmission|qbit/, "download"],
  [/node|bun|deno/, "code"],
  [/python|pip/, "terminal"],
  [/api|gateway/, "link"],
]

export function imageToIconKey(image: string): string {
  const name = image.toLowerCase()
  for (const [re, key] of IMAGE_HINTS) if (re.test(name)) return key
  return "container"
}

/** Container chip color by state — matches the Figma status palette. */
export function containerColor(state: string): string {
  if (state === "running") return "#22C55E"
  if (state === "paused" || state === "restarting") return "#F59E0B"
  if (state === "dead") return "#EF4444"
  return "#6B7280" // created / exited / unknown
}
