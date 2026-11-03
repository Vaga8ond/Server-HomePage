import { defineConfig } from "vitest/config"

// Unit tests: backend (node) + frontend pure-function tests (node env too —
// no DOM needed; component behavior is verified via tsc + build).
export default defineConfig({
  test: {
    include: ["backend/src/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
})
