import { defineConfig } from "vitest/config"

// Backend unit tests run standalone (cd backend && npm test) — they need
// this package's own node_modules (hono, dockerode), which the frontend
// CI job does not install.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
