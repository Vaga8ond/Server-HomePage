---
id: frontend-spa
type: module-design
status: draft
title: frontend · 仪表盘 SPA
parent: homebase-architecture
dependsOn: [backend-api]
---

# frontend · 仪表盘 SPA

## 职责

`src/`：React 19 SPA，只渲染后端告知的内容（原则见 goal）。

- **`App.tsx` — 壳**：hash 路由（`#/overview` …；未知 / 空 hash 回退 overview；刷新与前进后退存活）。**方向感知过渡**：按侧栏序号差定 `+1/-1`，250ms 滑动（含浏览器前进后退的正确方向）。overview / services eager 保证首屏，monitoring / storage / network / logs / design 懒加载（Suspense 包在移动容器内，过渡不因加载中断）。401 时全局切到 `TokenGate` 收集 Token。
- **视图**（`components/dashboard/*-view.tsx`，一视图一路由）：
  - `overview-view` — KPI 量表（CPU/内存/磁盘/网络，`netMaxMbps` 满刻度）+ 设备卡 + 流量热力图；
  - `services-view` / `service-card` / `container-controls` — 服务目录与启停按钮；
  - `containers-view`（监控）、`storage-view`、`network-view`、`logs-view`（级别解析与过滤在前端做）；
  - `design-view` — 链接目录，数据来自 `public/design-resources.json`（**编辑数据，不是代码**）。
- **`lib/` — 前端基础设施**：
  - `api.ts` — **唯一出口**：类型化 fetcher（全部 `/api` 端点）、Token 存取、`setOnUnauthorized` 回调；所有组件经它取数，禁止散装 `fetch`。
  - `use-poll.ts` — 轮询 hook（services 5s，与后端探测缓存对齐；各视图自带节奏）。
  - `use-theme.ts` / `mode-toggle` — 暗 / 亮主题，图表配色跟随。
  - `format.ts`（字节/时长/百分比）、`icons.ts`（`iconKey` → lucide 图标，未知回退 `Container`；与 backend 的 `IMAGE_HINTS` 键集需人工保持同步）、`data.ts`（`NAV_ITEMS` 导航序即路由序，方向感知依赖它）、`service-url.ts`（浏览器可点链接的推导——与后端 `PROBE_HOST` 探测地址是两条路径，架构不变式 3）。
- **`components/dashboard/charts/`** — recharts 主题化封装（面积图 / 周柱 / 磁盘环 / 热力图 / tooltip），视图不直接用 recharts 裸 API。
- **`token-gate.tsx`** — 401 后的 Token 输入门；静态层永不拦 SPA，鉴权 UX 全在前端。

## 边界

依赖 backend-api 的 HTTP 契约（`/api/*` JSON）——**契约类型在 `api.ts` 手工镜像** `backend/src/types.ts`，改后端类型必须同步（架构不变式 1）。不 import 后端代码、不直连 Docker、不做任何采集。

## 决策

- **hash 路由而非 router 库**：零依赖、深链接自然存活，单页 7 视图规模足够。
- **前端做日志级别解析**：后端只回原始尾部文本，解析/过滤留在渲染侧，后端保持哑管道。

## 已知现状

前端无测试（vitest include 仅 `backend/src/**`）；`icons.ts` 与后端图标推断表、`api.ts` 与 `types.ts` 两处人工同步是已知维护点。
