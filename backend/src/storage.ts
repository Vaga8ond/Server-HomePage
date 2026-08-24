import { execSync } from "node:child_process"
import { readFileSync, statfsSync } from "node:fs"
import { join } from "node:path"

const PROC = process.env.HOST_PROC ?? "/proc"
const FS_ROOT = process.env.HOST_FS ?? "/"

const VIRTUAL_FS = new Set([
  "proc", "sysfs", "tmpfs", "devtmpfs", "devpts", "cgroup", "cgroup2",
  "overlay", "squashfs", "mqueue", "shm", "efivarfs", "bpf", "fusectl",
  "configfs", "pstore", "debugfs", "tracefs", "securityfs", "autofs",
  "ramfs", "binfmt_misc", "hugetlbfs", "nsfs", "rpc_pipefs", "selinuxfs",
  "systemd-1", "fuse.snapfuse", "iso9660",
])

export interface StorageMount {
  device: string
  mount: string
  fstype: string
  total: number
  used: number
  free: number
  percent: number
}

/** Real filesystem mounts with statfs usage — host view via PID 1's
 *  /proc/mounts (same netns-style trick the metrics sampler uses).
 *  ponytail: no per-mount SMART/model data (needs smartctl); usage only. */
export function listMounts(): StorageMount[] {
  const seen = new Set<string>()
  const out: StorageMount[] = []
  const data = readProcMounts()
  if (!data) return darwinMounts() // no /proc (macOS dev) — df -P fallback
  for (const line of data.split("\n")) {
    const [device, mountRaw = "", fstype = ""] = line.split(/\s+/)
    if (!device || device === "none" || VIRTUAL_FS.has(fstype)) continue
    // /proc/mounts octal-escapes spaces etc. as \040
    const mount = mountRaw.replace(/\\([0-7]{3})/g, (_, o) =>
      String.fromCharCode(parseInt(o, 8)),
    )
    const key = `${device}:${mount}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const s = statfsSync(FS_ROOT === "/" ? mount : join(FS_ROOT, mount))
      const total = Number(s.blocks) * Number(s.bsize)
      const free = Number(s.bfree) * Number(s.bsize)
      if (total <= 0) continue
      const used = total - free
      out.push({ device, mount, fstype, total, used, free, percent: (used / total) * 100 })
    } catch {
      /* mount not reachable from this mount ns — skip */
    }
  }
  return out.sort((a, b) => b.total - a.total)
}

function readProcMounts(): string | null {
  try {
    return readFileSync(join(PROC, "1", "mounts"), "utf8")
  } catch {
    try {
      return readFileSync("/etc/mtab", "utf8")
    } catch {
      return null
    }
  }
}

/** macOS/dev fallback: `df -P` (1K-blocks, POSIX columns). Only used when
 *  /proc is absent — the Linux server path above stays authoritative.
 *  APFS volumes in one container (disk3s1, disk3s5, …) each report the
 *  *container* size, so naive per-device sums overcount ~N×; dedup to one
 *  row per physical disk (heaviest mount wins). */
function darwinMounts(): StorageMount[] {
  let out: string
  try {
    out = execSync("df -P -k", { encoding: "utf8" })
  } catch {
    return []
  }
  const rows = new Map<string, StorageMount>()
  for (const line of out.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const device = parts[0]
    const kbUsed = Number(parts[2])
    const kbAvail = Number(parts[3])
    const mount = parts.slice(5).join(" ")
    if (device.startsWith("map ") || device === "devfs") continue
    if (!Number.isFinite(kbUsed) || !Number.isFinite(kbAvail)) continue
    const total = (kbUsed + kbAvail) * 1024
    if (total <= 0) continue
    // disk3s1s1 / disk3s5 → disk3: one row per APFS container / physical disk
    const disk = device.replace(/(disk\d+)(s\d+)+$/, "$1")
    const used = kbUsed * 1024
    const prev = rows.get(disk)
    if (prev && prev.used >= used) continue
    rows.set(disk, { device: disk, mount, fstype: "—", total, used, free: kbAvail * 1024, percent: (used / total) * 100 })
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}
