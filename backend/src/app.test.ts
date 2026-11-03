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

  it("GET /api/uptime validates the window", async () => {
    const bad = await app.request("/api/uptime?window=bogus", { headers: auth })
    expect(bad.status).toBe(400)
    const good = await app.request("/api/uptime?window=24h", { headers: auth })
    expect(good.status).toBe(200)
  })

  it("GET /api/history supports custom from/to ranges", async () => {
    const nowMs = Date.now()
    const bad = await app.request(
      `/api/history?window=custom&from=${nowMs}&to=${nowMs - 1}`,
      { headers: auth },
    )
    expect(bad.status).toBe(400)
    const good = await app.request(
      `/api/history?window=custom&from=${nowMs - 3_600_000}&to=${nowMs}`,
      { headers: auth },
    )
    expect(good.status).toBe(200)
    const body = (await good.json()) as { window: string }
    expect(body.window).toBe("custom")
  })

  it("GET /api/containers/:name/logs/stream speaks SSE and accepts ?token=", async () => {
    const res = await app.request(
      "/api/containers/no-such-xyz/logs/stream?tail=10&token=test-token",
      { headers: auth },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    // docker present → open; absent/unknown container → error frame
    expect(["event: open", "event: error"].some((s) => text.includes(s))).toBe(true)
    await reader.cancel()
  })

  it("log stream rejects a bad token", async () => {
    const res = await app.request("/api/containers/x/logs/stream?token=WRONG")
    expect(res.status).toBe(401)
  })

  it("GET /api/compose-projects groups running compose containers", async () => {
    const res = await app.request("/api/compose-projects", { headers: auth })
    expect([200, 503]).toContain(res.status)
    if (res.status === 200) {
      const list = (await res.json()) as { project: string; containers: string[] }[]
      expect(Array.isArray(list)).toBe(true)
    }
  })

  it("GET /api/logs/merged speaks SSE; unknown project → error frame", async () => {
    const res = await app.request(
      "/api/logs/merged?project=zzz-none&tail=10&token=test-token",
      { headers: auth },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(["event: open", "event: error"].some((s) => text.includes(s))).toBe(true)
    await reader.cancel()
  })

  it("GET /api/containers/:name/logs clamps a bad tail param", async () => {
    // docker socket may exist here — only assert the route survives bad input
    const res = await app.request("/api/containers/x/logs?tail=bogus", {
      headers: auth,
    })
    expect([200, 503]).toContain(res.status)
    const res2 = await app.request("/api/containers/x/logs?tail=-5", {
      headers: auth,
    })
    expect([200, 503]).toContain(res2.status)
  })

  it("GET /api/containers/:name/logs accepts since variants", async () => {
    for (const q of [
      "?tail=50&since=1h",
      "?tail=50&since=24h",
      "?tail=50&since=custom&from=2020-01-01T00:00:00Z",
      "?tail=50&since=custom", // missing from → ignored, tail-only fetch
      "?tail=50&since=bogus", // unknown spec → ignored
    ]) {
      const res = await app.request(`/api/containers/x/logs${q}`, {
        headers: auth,
      })
      expect([200, 503]).toContain(res.status)
    }
  })

  it("GET /api/events defaults and clamps the hours parameter", async () => {
    const bad = await app.request("/api/events?hours=bogus", { headers: auth })
    expect(bad.status).toBe(200)
    expect(((await bad.json()) as { events: unknown[] }).events).toBeInstanceOf(Array)
    const good = await app.request("/api/events?hours=24", { headers: auth })
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
