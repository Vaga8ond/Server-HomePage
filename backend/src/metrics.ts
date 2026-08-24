import { execSync } from "node:child_process"
import { readdirSync, readFileSync, statfsSync } from "node:fs"
import {
  hostname as osHostname,
  loadavg,
  cpus,
  totalmem,
  type as osType,
  release as osRelease,
} from "node:os"
import { join } from "node:path"

import {
  defaultInterface as defaultIfaceName,
  listInterfaces,
} from "./network"
import type { HostMetrics } from "./types"

const PROC = process.env.HOST_PROC ?? "/proc"
const SYS = process.env.HOST_SYS ?? "/sys"
const FS_ROOT = process.env.HOST_FS ?? "/"
const DARWIN = process.platform === "darwin"

interface CpuSample {
  idle: number
  total: number
}
interface NetSample {
  rx: number
  tx: number
}

let prevCpu: CpuSample | null = null
let prevNet: NetSample | null = null
let lastTick = Date.now()
let snapshot: HostMetrics = empty()

function readHostInfo() {
  if (DARWIN) {
    return { hostname: osHostname(), os: `${osType()} ${osRelease()}` }
  }
  // Read the *host's* identity via the hostfs mount — /etc inside the
  // container is the runtime image's own.
  const hostname = (() => {
    const raw = tryRead(join(FS_ROOT, "etc", "hostname"))
    return raw ? raw.trim() : null
  })()
  const os = (() => {
    const raw = tryRead(join(FS_ROOT, "etc", "os-release"))
    const m = raw ? /^PRETTY_NAME="?([^"\n]+)"?/m.exec(raw) : null
    return m ? m[1] : null
  })()
  return { hostname, os }
}

function empty(): HostMetrics {
  return {
    ts: Date.now(),
    cpu: null,
    memory: null,
    disk: null,
    network: null,
    load: null,
    processes: null,
    tcpConnections: null,
    temperatureC: null,
    uptimeSeconds: null,
    netMaxMbps: null,
    hostInfo: null,
  }
}

function tryRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function readCpu(): CpuSample | null {
  if (DARWIN) {
    // Cumulative per-core times — same delta-in-tick() shape as the /proc path.
    let idle = 0
    let total = 0
    for (const c of cpus()) {
      idle += c.times.idle
      total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq
    }
    return total > 0 ? { idle, total } : null
  }
  const data = tryRead(join(PROC, "stat"))
  if (!data) return null
  const first = data.split("\n")[0] ?? ""
  const parts = first.split(/\s+/).slice(1).map(Number)
  if (parts.length < 4) return null
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0)
  const total = parts.reduce((a, b) => a + (b || 0), 0)
  return { idle, total }
}

function defaultInterface(): string | null {
  // /proc/net/route is netns-relative too — read PID 1's (host) table.
  const data = tryRead(join(PROC, "1", "net", "route"))
  if (!data) return null
  for (const line of data.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/)
    // Iface Destination ... — default route has Destination "00000000".
    if (parts.length >= 8 && parts[1] === "00000000") return parts[0]
  }
  return null
}

function readNet(): NetSample | null {
  // /proc/net/dev resolves to the reader's network namespace, so from inside a
  // container /host/proc/net/dev shows the container's own interfaces. Read
  // PID 1's netns (host) instead, and only the default-route interface to
  // avoid double-counting docker bridges / veth pairs.
  const data = tryRead(join(PROC, "1", "net", "dev"))
  if (!data) return DARWIN ? darwinNet() : null
  const want = defaultInterface()
  let rx = 0
  let tx = 0
  let seen = false
  for (const line of data.split("\n").slice(2)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 10) continue
    const iface = parts[0].replace(":", "")
    if (iface === "lo") continue
    if (want && iface !== want) continue
    seen = true
    rx += Number(parts[1]) || 0
    tx += Number(parts[9]) || 0
  }
  return seen ? { rx, tx } : null
}

/** macOS: cumulative byte counters of the default-route interface via
 *  network.ts's netstat parsing — same {rx,tx} shape, tick() does the delta. */
function darwinNet(): NetSample | null {
  const iface = defaultIfaceName()
  if (!iface) return null
  const found = listInterfaces().find((i) => i.name === iface)
  if (!found || found.rxBytes == null || found.txBytes == null) return null
  return { rx: found.rxBytes, tx: found.txBytes }
}

function readMem() {
  if (DARWIN) {
    // vm_stat: available ≈ free + inactive + speculative + purgeable pages.
    let out = ""
    try {
      out = execSync("vm_stat", { encoding: "utf8" })
    } catch {
      return null
    }
    const ps = Number(/page size of (\d+)/.exec(out)?.[1] ?? 4096)
    const pick = (label: string): number =>
      Number(new RegExp(`^${label}[^:]*:[\\s]+([\\d]+)`, "m").exec(out)?.[1] ?? 0) * ps
    const avail =
      pick("Pages free") + pick("Pages inactive") + pick("Pages speculative") + pick("Pages purgeable")
    const total = totalmem()
    const used = Math.max(0, total - avail)
    return { total, used, percent: total > 0 ? (used / total) * 100 : 0 }
  }
  const data = tryRead(join(PROC, "meminfo"))
  if (!data) return null
  const pick = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(data)
    return m ? Number(m[1]) * 1024 : null
  }
  const total = pick("MemTotal")
  const avail = pick("MemAvailable")
  if (total == null || avail == null) return null
  const used = total - avail
  return { total, used, percent: total > 0 ? (used / total) * 100 : 0 }
}

function readDisk() {
  try {
    const s = statfsSync(FS_ROOT)
    const total = Number(s.blocks) * Number(s.bsize)
    const free = Number(s.bfree) * Number(s.bsize)
    const used = total - free
    return { total, used, percent: total > 0 ? (used / total) * 100 : 0 }
  } catch {
    return null
  }
}

function readLoad() {
  if (DARWIN) {
    const [one = 0, five = 0, fifteen = 0] = loadavg()
    return { one, five, fifteen }
  }
  const data = tryRead(join(PROC, "loadavg"))
  if (!data) return null
  const p = data.split(/\s+/)
  return { one: Number(p[0]), five: Number(p[1]), fifteen: Number(p[2]) }
}

function readProcesses(): number | null {
  if (DARWIN) {
    try {
      return Number(execSync("ps -axo pid=", { encoding: "utf8" }).trim().split("\n").length)
    } catch {
      return null
    }
  }
  try {
    return readdirSync(PROC).filter((n) => /^\d+$/.test(n)).length
  } catch {
    return null
  }
}

function readTcp(): number | null {
  if (DARWIN) {
    try {
      return execSync("netstat -an -p tcp", { encoding: "utf8" })
        .split("\n")
        .filter((l) => /ESTABLISHED/.test(l)).length
    } catch {
      return null
    }
  }
  // /proc/net/* resolves to the *reader's* network namespace, so from inside a
  // container /host/proc/net/tcp shows the container's own (empty) table.
  // Read PID 1's netns instead — host init lives in the host netns.
  let count = 0
  let saw = false
  for (const name of ["tcp", "tcp6"]) {
    const data = tryRead(join(PROC, "1", "net", name))
    if (!data) continue
    saw = true
    for (const line of data.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 4 && parts[3] === "01") count++
    }
  }
  return saw ? count : null
}

function readTemp(): number | null {
  try {
    const zones = readdirSync(join(SYS, "class", "thermal")).filter((n) =>
      n.startsWith("thermal_zone"),
    )
    let max: number | null = null
    for (const zone of zones) {
      const raw = tryRead(join(SYS, "class", "thermal", zone, "temp"))
      if (!raw) continue
      const c = Number(raw.trim()) / 1000
      if (Number.isFinite(c)) max = max == null ? c : Math.max(max, c)
    }
    return max
  } catch {
    return null
  }
}

function readNicSpeed(): number | null {
  // Link speed of the default-route interface (Mbps). /sys/class/net/<if>/speed
  const iface = defaultInterface()
  if (!iface) return null
  const raw = tryRead(join(SYS, "class", "net", iface, "speed"))
  if (!raw) return null
  const v = Number(raw.trim())
  return Number.isFinite(v) && v > 0 ? v : null
}

function readUptime(): number | null {
  if (DARWIN) {
    try {
      const sec = Number(/{ sec = (\d+)/.exec(execSync("sysctl -n kern.boottime", { encoding: "utf8" }))?.[1])
      return Number.isFinite(sec) ? Date.now() / 1000 - sec : null
    } catch {
      return null
    }
  }
  const data = tryRead(join(PROC, "uptime"))
  if (!data) return null
  return Number(data.split(/\s+/)[0])
}

function tick(): void {
  const now = Date.now()
  const dt = (now - lastTick) / 1000
  lastTick = now

  const cpu = readCpu()
  let cpuPercent: number | null = null
  if (cpu && prevCpu) {
    const dTotal = cpu.total - prevCpu.total
    const dIdle = cpu.idle - prevCpu.idle
    if (dTotal > 0) cpuPercent = (1 - dIdle / dTotal) * 100
  }
  prevCpu = cpu

  const net = readNet()
  let netRate: HostMetrics["network"] = null
  if (net && prevNet && dt > 0) {
    netRate = {
      rxBytesPerSec: Math.max(0, (net.rx - prevNet.rx) / dt),
      txBytesPerSec: Math.max(0, (net.tx - prevNet.tx) / dt),
    }
  }
  prevNet = net

  snapshot = {
    ts: now,
    cpu: cpuPercent != null ? { percent: cpuPercent } : null,
    memory: readMem(),
    disk: readDisk(),
    network: netRate,
    load: readLoad(),
    processes: readProcesses(),
    tcpConnections: readTcp(),
    temperatureC: readTemp(),
    uptimeSeconds: readUptime(),
    netMaxMbps: readNicSpeed(),
    hostInfo: readHostInfo(),
  }
}

let started = false

export function startSampler(): void {
  if (started) return
  started = true
  prevCpu = readCpu()
  prevNet = readNet()
  lastTick = Date.now()
  tick()
  setInterval(tick, 1000).unref?.()
}

export function getSnapshot(): HostMetrics {
  if (!started) startSampler()
  return snapshot
}
