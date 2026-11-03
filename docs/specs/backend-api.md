---
id: backend-api
type: module-design
status: draft
title: backend · API 服务层
parent: homebase-architecture
dependsOn: [backend-telemetry, docker-integration, service-catalog, host-facts]
---

# backend · API 服务层

## 职责

`backend/src/app.ts` + `index.ts`：整个系统的 HTTP 面。它是唯一被允许组合各采集模块的地方，此外还承担可选鉴权与静态 SPA 服务。

- `index.ts` — 入口：`serve({ fetch: app.fetch, port: PORT })`，`PORT` 默认 `8088`。
- **模块加载即产生副作用**：`app.ts` 顶层调用 `startSampler()`（1s 采样）与 `startRecorder()`（15s 落盘）——import 本模块即启动遥测。
- **鉴权中间件**：`apiToken()`（service-catalog 提供）非空时，`/api/*` 一律校验 `Authorization: Bearer`；`/api/health` 豁免（监控用）。无 Token 则整个 API 开放。
- **静态层**（生产）：`STATIC_DIR` 存在时 `GET *` 服务 SPA——路径穿越防护（`normalize` + 带尾分隔符的前缀比较，防 `public-backup` 式兄弟目录）；`index.html` 永远 `no-cache`（新部署即时可达），`/assets/*` 内容哈希 `immutable` 一年，其余 1h；进程内文件缓存按 mtime 失效；未命中文件回退 `index.html`（hash 路由深链接）。

## 路由一览

| 路由 | 来源模块 |
| --- | --- |
| `GET /api/health` | 自身（`{ ok, ts }`） |
| `GET /api/host` | backend-telemetry（快照） |
| `GET /api/devices` | host-facts（glances / 连通性） |
| `GET /api/services` | service-catalog + docker-integration（目录 ∪ 发现，组合逻辑在此） |
| `GET /api/containers` | docker-integration |
| `GET /api/history?window=` | backend-telemetry（窗口白名单 `1h/6h/24h/7d/custom`，越界 400；`custom` 需 `from/to` epoch-ms，钳到 ≤now 与 ≤30d 保留期，步长 ≈300 桶对齐 15s 网格，空范围 400） |
| `GET /api/history/aggregate` | backend-telemetry（周统计 / 热力图） |
| `GET /api/uptime?window=` | service-catalog 探测历史（窗口白名单 `24h/7d`，越界 400；每服务分桶 ratio + 平均延迟 + 全窗 uptimePct） |
| `GET /api/events?hours=` | docker-integration 事件流（hours 钳 1..720 默认 24；倒序 LIMIT 500，`{ t, container, action, detail }`） |
| `GET /api/storage` | host-facts |
| `GET /api/network` | host-facts |
| `GET /api/containers/:name/logs` | `?tail=` 钳 50..5000 默认 500（坏值回退默认）；`?since=1h\|24h\|custom`（custom 需 `from`[/`to`]，ISO，缺 from 或未知 spec → 忽略，退回纯 tail；语义对齐 `/api/history` 的 custom）；后端开 `timestamps:true` 逐行 RFC3339Nano 前缀；docker-integration（失败 503 + message） |
| `GET /api/containers/:name/logs/stream` | SSE 实时日志流（follow），`?tail=` 同上；事件 `open` / `line {type,line}` / `error`；客户端断开（abort/cancel）清理 docker 流，30s 心跳注释帧防代理空闲断链；`?token=` 查询参数仅为 EventSource 无法带 header 而开，与 Authorization 头等效 |
| `GET /api/compose-projects` | 运行中容器按 compose 项目分组（label 优先、名称模式推导兑底；5s 缓存）；docker-integration |
| `GET /api/logs/merged` | SSE 合并流：`?project=` + `?tail=`，按项目解析运行中容器（无匹配 → `error` 事件后关流）；事件 `open {project,containers}` / `line {name,type,line}` / `error`；心跳与断开清理同上 |
| `POST /api/containers/:name/:action` | docker-integration（action 白名单 `start/stop/restart`，越界 400） |

## 边界

允许 import 四个后端模块与 `hono`、node 内建；**禁止**直接读 `/proc`、`/sys`、Docker socket、glances、外部 HTTP——一切经对应模块。前端契约类型以 `backend/src/types.ts` 为源（见架构不变式 1）。

## 已知现状

- 错误约定：容器操作失败返回 `503` + `{ error }`（Docker 不可达 / 容器缺失），不是 5xx 泛化。
- 测试：仅 `app.test.ts` 路由冒烟；中间件与静态层无专门测试。
