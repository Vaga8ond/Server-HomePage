import { defineConfig } from "vitest/config"

// Frontend pure-function tests only (node env — no DOM needed; component
// behavior is verified via tsc + build). Backend tests run separately:
// cd backend && npm test (they need backend's own node_modules).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
