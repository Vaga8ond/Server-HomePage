import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** network.ts reads /proc via HOST_PROC at module load — point it at a
 *  fixture dir BEFORE importing (deterministic on macOS dev and Linux CI). */
const procDir = join(mkdtempSync(join(tmpdir(), "hb-proc-")), "proc")
mkdirSync(join(procDir, "1", "net"), { recursive: true })
writeFileSync(
  join(procDir, "1", "net", "route"),
  [
    "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
    "eth0\t00000000\tFE000001\t0003\t0\t0\t100\t00000000\t0\t0\t0",
    "eth0\tFE000000\t00000000\t0001\t0\t0\t100\tFE000000\t0\t0\t0",
    "wan0\t0000A8C0\t00000000\t0001\t0\t0\t0\t0000FFF0\t0\t0\t0",
  ].join("\n"),
)
process.env.HOST_PROC = procDir

const { defaultInterface, parseNetstatCounters } = await import("./network")

describe("parseNetstatCounters", () => {
  it("takes the first row per interface and parses rx/tx columns", () => {
    const text = [
      "Name  Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll",
      "en0   1500 <Link#14> aa 1 2 111 3 4 222 0",
      "en0   1500 <Link#14> aa 9 9 999 9 9 999 0", // duplicate — must be ignored
      "en5   1500 <Link#12> bb 1 2 10 3 4 20 0",
      "short line",
    ].join("\n")
    const counters = parseNetstatCounters(text)
    expect(counters.get("en0")).toEqual({ rx: 111, tx: 222 })
    expect(counters.get("en5")).toEqual({ rx: 10, tx: 20 })
    expect(counters.size).toBe(2)
  })

  it("returns an empty map for unusable output", () => {
    expect(parseNetstatCounters("").size).toBe(0)
    expect(parseNetstatCounters("garbage\na b c").size).toBe(0)
  })
})

describe("defaultInterface (HOST_PROC fixture)", () => {
  it("finds the iface with default route (destination 00000000)", () => {
    expect(defaultInterface()).toBe("eth0")
  })
})
