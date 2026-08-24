# HomeBase · Self-hosted Server Homepage

[English](README.md) | [简体中文](README.zh-CN.md)

[![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Hono](https://img.shields.io/badge/Hono-FF6A33?style=for-the-badge)](https://hono.dev)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)

## What is this

A glassmorphism server homepage for your homelab: one page that answers "is everything up, and is the box healthy". The Hono backend reads the real host through `/proc` / `/sys` / sysfs (with macOS fallbacks for dev), samples every second, keeps 30 days of JSONL history, probes every service, and talks to the Docker socket — the React frontend just renders what it's told. No agent to install, no database, no config file required.

| Overview · KPI + charts | Services · auto-discovered |
| --- | --- |
| ![overview](docs/shot/01-overview.png) | ![services](docs/shot/02-services.png) |
| **Monitoring · containers** | **Storage · mounts** |
| ![monitoring](docs/shot/03-monitoring.png) | ![storage](docs/shot/04-storage.png) |
| **Network · interfaces** | **Logs · stream** |
| ![network](docs/shot/05-network.png) | ![logs](docs/shot/06-logs.png) |
| **Design · resources** | |
| ![design](docs/shot/07-design.png) | |

## Features

- **Zero-config service catalog** — running Docker containers with published ports are discovered automatically (icon and color inferred from the image name); manual entries in `backend/config/services.json` win over discovery and carry curated metadata.
- **Real host metrics** — CPU / memory / load / TCP / uptime / net counters sampled every second from PID 1's `/proc` (host netns), with Darwin fallbacks (`vm_stat`, `ps`, `netstat`, `sysctl`) so the same code runs on a Mac.
- **30-day history** — metrics recorded as daily JSONL files, downsampled per window (1h / 6h / 24h / 7d, ~300 buckets each) powering sparklines, the traffic area chart, weekly bars and a GitHub-style heatmap.
- **Container control** — live CPU / memory per container, log streaming with level parsing and filters, start / stop / restart buttons wired straight to the Docker socket.
- **Storage & network views** — real filesystem mounts via `statfs` (virtual FS filtered), interfaces with link state, speed, addresses and boot-cumulative traffic.
- **The details** — dark/light themes, hash routing (deep links survive refresh), 250ms view transitions, charts that follow the theme, `prefers-reduced-motion` respected.

## Quick start

```bash
# backend (API on :8787)
cd backend && npm install
npm run dev

# frontend (Vite on :5173, proxies /api → :8787)
npm install
npm run dev
```

Deploy the prebuilt image (serves the API and the static SPA on one port):

```bash
docker run -d --name homebase \
  -p 8787:8787 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -e HOST_PROC=/host/proc -e HOST_SYS=/host/sys \
  ghcr.io/unborracho/homebase:latest
```

Reads plain `/proc` and `/sys` when running on the host — mount them only inside a container. Node ≥ 22.

## Structure

```
backend/src/
  index.ts    # Hono routes + SPA fallback
  metrics.ts  # 1s host sampler (Linux /proc//sys, Darwin fallbacks)
  history.ts  # JSONL history, per-window downsampling
  recorder.ts # writes metrics to data/hist-YYYY-MM-DD
  docker.ts   # container list/state/logs/actions + auto-discovery
  probe.ts    # service HTTP probes (5s cache, 3s timeout)
  storage.ts  # real mounts via statfs, virtual FS filtered
  network.ts  # interfaces, counters, default route
  config.ts   # services.json catalog (SERVICES_CONFIG overrides)
src/
  App.tsx     # hash-routed views, 250ms view-enter transition
  components/dashboard/   # one view per route + shared cards
  components/dashboard/charts/  # recharts wrappers, theme-aware
  lib/        # api fetchers, usePoll, formatters, icons
public/design-resources.json   # Design page link catalog (edit, don't code)
```

Key knobs: `PORT`, `HOST_PROC` / `HOST_SYS` / `HOST_FS` (host mounts in-container), `PROBE_HOST` (defaults `host.docker.internal`; use `127.0.0.1` for local dev), `DATA_DIR`, `SERVICES_CONFIG`.

## License

MIT.
