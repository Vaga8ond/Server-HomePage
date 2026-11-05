/* Verify skeleton -> content transition on the 4 dashboard views.
   Each view gets a FRESH page (full load, like a refresh deep-link) with CDP
   latency so the skeleton phase is observable. Completion = all .sk gone. */
import { chromium } from "playwright-core"
import fs from "node:fs"

const OUT = "/tmp/skel-shots"
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const BASE = "http://localhost:8099"

async function checkView(ctx, hash, name, delayApi) {
  const page = await ctx.newPage()
  // freeze the skeleton phase for screenshots: hold the first API response
  if (delayApi) {
    await page.route(`**/api/${delayApi}`, async (route) => {
      await new Promise((r) => setTimeout(r, 3000))
      await route.continue()
    })
  }
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 400,
    downloadThroughput: 200 * 1024, uploadThroughput: 100 * 1024,
  })
  await page.goto(`${BASE}/#/${hash}`, { waitUntil: "domcontentloaded" })
  // Phase 1: skeleton blocks visible (first paint under latency)
  let skelFound = false
  try {
    await page.waitForSelector(".sk", { timeout: 6000 })
    skelFound = true
    await page.screenshot({ path: `${OUT}/${name}-skeleton.png` })
  } catch {
    skelFound = false
  }
  // Phase 2: skeleton fully replaced by real content
  await page.waitForFunction(() => document.querySelectorAll(".sk").length === 0, {
    timeout: 20000,
  })
  await page.waitForTimeout(900) // let stagger settle
  const skelLeft = await page.locator(".sk").count()
  await page.screenshot({ path: `${OUT}/${name}-content.png` })
  const glassCards = await page.locator(".glass-card").count()
  console.log(`${name}: skeleton=${skelFound} skelLeft=${skelLeft} glassCards=${glassCards}`)
  await page.close()
  return skelFound && skelLeft === 0 && glassCards > 0
}

;(async () => {
  const results = []
  const browser = await chromium.launch({ headless: true, channel: "chrome" })
    .catch(() => chromium.launch({ headless: true }))
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  for (const [hash, name, api] of [
    ["overview", "overview", "host"],
    ["services", "services", "services"],
    ["monitoring", "monitoring", "containers"],
    ["logs", "logs", null],
  ]) {
    results.push(await checkView(ctx, hash, name, api))
  }

  await browser.close()
  const pass = results.every(Boolean)
  console.log(pass ? "PASS" : "FAIL", results)
  process.exit(pass ? 0 : 1)
})()

