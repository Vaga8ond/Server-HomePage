import { Component, type ReactNode } from "react"

interface State {
  error: Error | null
}

/** Top-level crash guard — a render error in any view shows a reload panel
 *  instead of a blank page. Lives outside the router (main.tsx). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("render crash:", error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0a0e14] px-6 text-center">
        <div className="text-sm font-semibold text-ink">
          Something broke while rendering
        </div>
        <div className="mono max-w-md text-xs break-all text-ink-faint">
          {this.state.error.message}
        </div>
        <button
          onClick={() => location.reload()}
          className="glass-card px-4 py-2 text-xs text-ink transition-colors hover:bg-ink/5"
        >
          Reload
        </button>
      </div>
    )
  }
}
