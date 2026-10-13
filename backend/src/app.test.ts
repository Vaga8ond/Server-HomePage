import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

/** Env fixtures must precede the app import — config/metrics read them at
 *  module load. STATIC_DIR unset → static block skipped, routes only. */
const dataDir = mkdtempSync(join(tmpdir(), "hb-app-"))
process.env.DATA_DIR = dataDir
process.env.API_TOKEN = "test-token"
delete process.env.STATIC_DIR

import type { Hono } from "hono"

let app: Hono
beforeAll(async () => {
  ;({ app } = await import("./app"))
})

const auth = { authorization: "Bearer test-token" }

describe("api routes", () => {
  it("GET /api/health is public", async () => {
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
  })

  it("rejects missing bearer token", async () => {
    const res = await app.request("/api/host")
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error: string }
    expect(j.error).toBe("unauthorized")
  })

  it("GET /api/host serves a snapshot", async () => {
    const res = await app.request("/api/host", { headers: auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toBeTypeOf("object")
  })

  it("GET /api/devices serves an array", async () => {
    const res = await app.request("/api/devices", { headers: auth })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it("GET /api/history validates the window", async () => {
    const bad = await app.request("/api/history?window=bogus", { headers: auth })
    expect(bad.status).toBe(400)
    const good = await app.request("/api/history?window=1h", { headers: auth })
    expect(good.status).toBe(200)
  })

  it("POST container action rejects invalid action", async () => {
    const res = await app.request("/api/containers/x/frobnicate", {
      method: "POST",
      headers: auth,
    })
    expect(res.status).toBe(400)
  })

  it("404s unknown api paths", async () => {
    const res = await app.request("/api/nope", { headers: auth })
    expect(res.status).toBe(404)
  })
})
