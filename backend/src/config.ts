import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { ServiceConfig } from "./types"

const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH =
  process.env.SERVICES_CONFIG ?? join(HERE, "..", "config", "services.json")

/**
 * Services listen on the *host* — from inside the container the host is reached
 * via host.docker.internal (compose maps it to host-gateway). On a dev machine
 * (backend outside Docker) override with PROBE_HOST=127.0.0.1.
 */
const PROBE_HOST = process.env.PROBE_HOST ?? "host.docker.internal"

/** Last parseable catalog — served while the file is broken (mid-edit, bad JSON). */
let lastGood: ServiceConfig[] = []
let lastWarn = 0

function warn(msg: string): void {
  if (Date.now() - lastWarn < 60_000) return // at most once a minute
  lastWarn = Date.now()
  console.warn(`config: ${msg}`)
}

function looksLikeService(s: unknown): boolean {
  return (
    !!s &&
    typeof s === "object" &&
    typeof (s as ServiceConfig).name === "string" &&
    typeof (s as ServiceConfig).port === "number"
  )
}

/** Read on every call — services.json is a per-server volume mount; edits apply
 *  live without a restart. A broken file falls back to the last good catalog
 *  instead of 500ing the dashboard; individual malformed entries are dropped. */
export function readServices(): ServiceConfig[] {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
      services?: unknown
    }
    if (!Array.isArray(raw.services)) {
      throw new Error("services[] missing or not an array")
    }
    const valid = raw.services.filter((s): s is ServiceConfig => {
      if (looksLikeService(s)) return true
      warn(`dropping malformed entry ${JSON.stringify(s)?.slice(0, 80)}`)
      return false
    })
    lastGood = valid
    return valid
  } catch (err) {
    warn(
      `${CONFIG_PATH} unreadable (${(err as Error).message}) — ` +
        `serving last good catalog (${lastGood.length} services)`,
    )
    return lastGood
  }
}

/** Bearer token for the API — API_TOKEN env wins, else <repo root>/.api-token.
 *  No token configured → API stays open (local dev, air-gapped LAN). */
const TOKEN_PATH = process.env.API_TOKEN_FILE ?? join(HERE, "..", "..", ".api-token")
let cachedToken: string | null | undefined

export function apiToken(): string | null {
  if (cachedToken !== undefined) return cachedToken
  if (process.env.API_TOKEN) {
    cachedToken = process.env.API_TOKEN
    return cachedToken
  }
  try {
    cachedToken = readFileSync(TOKEN_PATH, "utf8").trim() || null
  } catch {
    cachedToken = null
  }
  return cachedToken
}

/** Where the backend probes; the browser link is derived client-side instead. */
export function probeUrl(svc: ServiceConfig): string {
  if (svc.url) return svc.url
  return `${svc.scheme ?? "http"}://${PROBE_HOST}:${svc.port}`
}
