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
  - `overview-view` — 顶部 **`health-strip`**（`lib/health.ts` 纯函数 `computeHealth` 聚合：停止容器数→monitoring、服务 error 数→services、最低 24h 可用率→services、磁盘≥90%→storage、24h 异常事件（oom/health_status unhealthy，普通 die 不算）→logs；全绿低调绿条，异常项红/黄 chip 可点击跳转）+ KPI 卡（Network/CPU/Memory/Disk 带 24h spark + 趋势箭头，Uptime；`KpiCard` 支持 `to` 下钻：Network→network、CPU/Mem→monitoring、Disk→storage）+ 设备卡 + 流量热力图 + **Activity 卡**（`events-timeline`：容器生命周期事件 + `serviceFlips` 从 /api/uptime 桶推导的服务 down/degraded/recovered 翻转，合并倒序、异常着色）+ 页头新鲜度徽标（`usePoll` 暴露 `lastOk`，超 3× 轮询间隔或报错转黄 stale）；
  - `services-view` / `service-card` / `container-controls` — 服务目录与启停按钮；卡片带 GitHub 风可用性条（`uptime-bar`，`/api/uptime` 分桶绿/黄/红/灰，列表头部 `24h/7d` 切换，60s 轮询）；
  - `containers-view`（监控）、`storage-view`、`network-view`、`logs-view`（级别解析与时间戳剥离在前端做：`parseLine` 识别 RFC3339Nano 前缀 → `MM-DD HH:MM:SS` 时间列。**single 模式**：快照行数选择器 200/500/1000/2000 + 范围 chips `all/1h/24h/custom`（custom 双 datetime-local 输入，apply 才 refetch）传 `?since=`；live 按钮接 SSE 流（docker 先回放 tail 再 follow）。**merged 模式**：整 compose 项目实时流（`/api/logs/merged`，项目 chips 选择，选择即 live，无快照形态），每行带容器名列按调色板着色（与后端 AUTO_COLORS 同套），图例 chips 点击过滤显示（全显⇄隐藏集合）；追尾/浮标/环形缓冲 5000/content-visibility 护栏两模式共用）；
  - `design-view` — 链接目录，数据来自 `public/design-resources.json`（**编辑数据，不是代码**）。
- **`lib/` — 前端基础设施**：
  - `api.ts` — **唯一出口**：类型化 fetcher（全部 `/api` 端点）、Token 存取、`setOnUnauthorized` 回调；所有组件经它取数，禁止散装 `fetch`。
  - `use-poll.ts` — 轮询 hook（services 5s，与后端探测缓存对齐；各视图自带节奏，可用性条 60s）。
  - `use-theme.ts` / `mode-toggle` — 暗 / 亮主题，图表配色跟随。
  - `format.ts`（字节/时长/百分比）、`icons.ts`（`iconKey` → lucide 图标，未知回退 `Container`；与 backend 的 `IMAGE_HINTS` 键集需人工保持同步）、`data.ts`（`NAV_ITEMS` 导航序即路由序，方向感知依赖它）、`service-url.ts`（浏览器可点链接的推导——与后端 `PROBE_HOST` 探测地址是两条路径，架构不变式 3）。
- **`components/dashboard/charts/`** — recharts 主题化封装（面积图 / 周柱 / 磁盘环 / 热力图 / tooltip），视图不直接用 recharts 裸 API。面积图支持 `custom` 自定义区间（datetime-local 双输入 + 应用按钮，输入不触发请求、应用才 refetch；未应用前回退 24h 数据）。
- **`token-gate.tsx`** — 401 后的 Token 输入门；静态层永不拦 SPA，鉴权 UX 全在前端。

## 边界

依赖 backend-api 的 HTTP 契约（`/api/*` JSON）——**契约类型在 `api.ts` 手工镜像** `backend/src/types.ts`，改后端类型必须同步（架构不变式 1）。不 import 后端代码、不直连 Docker、不做任何采集。

## 决策

- **hash 路由而非 router 库**：零依赖、深链接自然存活，单页 7 视图规模足够。
- **前端做日志级别解析**：后端只回原始尾部文本，解析/过滤留在渲染侧，后端保持哑管道。

## 已知现状

前端无测试（vitest include 仅 `backend/src/**`）；`icons.ts` 与后端图标推断表、`api.ts` 与 `types.ts` 两处人工同步是已知维护点。
