import { defineConfig } from "vitest/config"

// Backend-only unit tests. Separate from vite.config.ts (frontend build).
export default defineConfig({
  test: {
    include: ["backend/src/**/*.test.ts"],
    environment: "node",
  },
})
