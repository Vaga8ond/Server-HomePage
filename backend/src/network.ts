import { execSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { join } from "node:path"

const PROC = process.env.HOST_PROC ?? "/proc"
const SYS = process.env.HOST_SYS ?? "/sys"

export interface NetInterface {
  name: string
  state: string
  speedMbps: number | null
  addresses: string[]
  /** Cumulative counters since boot (bytes), null when unreadable. */
  rxBytes: number | null
  txBytes: number | null
}

export function defaultInterface(): string | null {
  const data = tryRead(join(PROC, "1", "net", "route"))
  if (!data) return darwinDefaultInterface()
  for (const line of data.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 8 && parts[1] === "00000000") return parts[0]
  }
  return null
}

/** macOS: `route -n get default` → "interface: en0". */
function darwinDefaultInterface(): string | null {
  try {
    const m = /interface:\s*(\S+)/.exec(execSync("route -n get default", { encoding: "utf8" }))
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Interface list with link state, IPs and boot-cumulative traffic counters.
 *  ponytail: sysfs net-class is per-netns, so inside a container this shows
 *  the container's links; run backend on the host (or host netns) for the
 *  full picture. */
export function listInterfaces(): NetInterface[] {
  let names: string[] = []
  try {
    names = readdirSync(join(SYS, "class", "net")).filter((n) => !n.startsWith("."))
  } catch {
    names = []
  }
  const addrs = networkInterfaces()
  if (names.length === 0) return darwinInterfaces(addrs) // no sysfs (macOS dev)
  const counters = readNetDev()
  return names.map((name) => {
    const c = counters.get(name)
    return {
      name,
      state: (tryRead(join(SYS, "class", "net", name, "operstate")) ?? "?").trim(),
      speedMbps: Number(tryRead(join(SYS, "class", "net", name, "speed")) ?? 0) || null,
      addresses: (addrs[name] ?? [])
        .filter((a) => !a.internal)
        .map((a) => a.address),
      rxBytes: c ? c.rx : null,
      txBytes: c ? c.tx : null,
    }
  })
}

/** macOS/dev fallback: os.networkInterfaces() for names/IPs + `netstat -ib`
 *  for boot-cumulative byte counters. No link state on darwin — infer "up"
 *  from having a non-internal address. */
function darwinInterfaces(
  addrs: ReturnType<typeof networkInterfaces>,
): NetInterface[] {
  let netstat = ""
  try {
    netstat = execSync("netstat -ib", { encoding: "utf8" })
  } catch {
    netstat = ""
  }
  // Name ... Ipkts Ierrs Ibytes Opkts Oerrs Obytes — first row per iface wins
  const counters = new Map<string, { rx: number; tx: number }>()
  for (const line of netstat.split("\n").slice(1)) {
    const p = line.trim().split(/\s+/)
    if (p.length < 10) continue
    if (!counters.has(p[0]))
      counters.set(p[0], { rx: Number(p[6]) || 0, tx: Number(p[9]) || 0 })
  }
  return Object.entries(addrs)
    .filter(([name]) => name !== "lo0")
    .map(([name, list]) => {
      const real = (list ?? []).filter((a) => !a.internal)
      const c = counters.get(name)
      return {
        name,
        state: real.length > 0 ? "up" : "down",
        speedMbps: null,
        addresses: real.map((a) => a.address),
        rxBytes: c ? c.rx : null,
        txBytes: c ? c.tx : null,
      }
    })
}

/** Cumulative rx/tx per interface from PID 1's /proc/net/dev (host netns). */
function readNetDev(): Map<string, { rx: number; tx: number }> {
  const map = new Map<string, { rx: number; tx: number }>()
  const data = tryRead(join(PROC, "1", "net", "dev"))
  if (!data) return map
  for (const line of data.split("\n").slice(2)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 10) continue
    map.set(parts[0].replace(":", ""), {
      rx: Number(parts[1]) || 0,
      tx: Number(parts[9]) || 0,
    })
  }
  return map
}

function tryRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}
