import { useState } from "react"

import { setToken } from "@/lib/api"

/** Full-screen gate shown after a 401 — enter the server's API token once;
 *  it persists in localStorage and the page reloads into the dashboard. */
export function TokenGate() {
  const [value, setValue] = useState("")
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <form
        className="glass-card w-full max-w-sm px-6 py-8"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) {
            setToken(value)
            location.reload()
          }
        }}
      >
        <div className="mb-1 text-sm font-semibold text-ink">API token required</div>
        <div className="mono mb-5 text-[11px] text-ink-faint">
          paste the token from the server (~/homebase/.api-token)
        </div>
        <input
          autoFocus
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="token"
          aria-label="API token"
          className="mono mb-4 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-xs text-ink outline-none focus:border-ink/30"
        />
        <button
          type="submit"
          className="glass-card w-full py-2 text-xs font-semibold text-ink transition-colors hover:bg-ink/5"
        >
          Unlock
        </button>
      </form>
    </div>
  )
}
