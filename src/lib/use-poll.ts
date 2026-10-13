import { useCallback, useEffect, useRef, useState } from "react"

interface PollState<T> {
  data: T | null
  error: Error | null
  loading: boolean
  refetch: () => void
}

/**
 * Polls `fetcher` immediately, then every `intervalMs`. On error the last
 * successful value is retained (stale) alongside the error flag so the UI can
 * keep showing data while a reconnect is attempted. `refetch` triggers an
 * immediate re-run (used after mutating actions like container start/stop).
 */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
): PollState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const run = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // Tab hidden (or phone locked): skip the fetch entirely and re-check
    // shortly — visibilitychange fires run() the moment we're visible again.
    if (typeof document !== "undefined" && document.hidden) {
      timerRef.current = setTimeout(run, 2000)
      return
    }
    ;(async () => {
      try {
        const value = await fetcherRef.current()
        setData(value)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        timerRef.current = setTimeout(run, intervalMs)
      }
    })()
  }, [intervalMs])

  useEffect(() => {
    run()
    const onVisibility = () => {
      if (!document.hidden) run()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [run])

  return { data, error, loading: data === null && error === null, refetch: run }
}
