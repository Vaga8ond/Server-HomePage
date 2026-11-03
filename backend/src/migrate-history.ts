import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { DATA_DIR, db, insertSample, type SampleRow } from "./store"

/**
 * One-time import of the legacy daily JSONL history files (hist-YYYY-MM-DD.jsonl)
 * into SQLite. Run manually at switch time:
 *
 *   npm run migrate:history
 *
 * Skips corrupt lines with the same tolerance the old JSONL reader had. A
 * meta.imported_at marker makes the run idempotent. Verify the charts, then
 * delete the legacy files yourself (rm data/hist-*.jsonl).
 */

const PREFIX = "hist-"

const nul = (v: unknown): number | null => (v == null ? null : (v as number))

const imported = db.prepare("SELECT value FROM meta WHERE key = 'imported_at'").get() as
  | { value: string }
  | undefined
if (imported) {
  console.log(`history already imported at ${imported.value} — nothing to do`)
  console.log("(once verified, remove legacy files: rm data/hist-*.jsonl)")
  process.exit(0)
}

let files: string[]
try {
  files = readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".jsonl"))
    .sort()
} catch {
  console.log("no data directory — nothing to import")
  process.exit(0)
}

if (files.length === 0) {
  console.log("no legacy hist-*.jsonl files — nothing to import")
  process.exit(0)
}

let rows = 0
let skipped = 0

db.exec("BEGIN")
try {
  for (const f of files) {
    const text = readFileSync(join(DATA_DIR, f), "utf8")
    for (const line of text.split("\n")) {
      if (!line) continue
      let p: Partial<SampleRow>
      try {
        p = JSON.parse(line) as Partial<SampleRow>
      } catch {
        skipped++
        continue
      }
      if (typeof p.t !== "number" || !Number.isFinite(p.t)) {
        skipped++
        continue
      }
      insertSample({
        t: p.t,
        cpu: nul(p.cpu),
        mem: nul(p.mem),
        disk: nul(p.disk),
        rx: nul(p.rx),
        tx: nul(p.tx),
        load: nul(p.load),
        tcp: nul(p.tcp),
        temp: nul(p.temp),
      })
      rows++
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('imported_at', ?)").run(new Date().toISOString())
  db.exec("COMMIT")
} catch (err) {
  db.exec("ROLLBACK")
  console.error("import failed, rolled back:", err)
  process.exit(1)
}

console.log(`imported ${rows} samples from ${files.length} file(s) (${skipped} corrupt lines skipped)`)
console.log("verify the charts, then remove legacy files: rm data/hist-*.jsonl")
