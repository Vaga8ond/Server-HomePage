---
id: homebase-architecture
type: architecture-design
status: draft
title: 架构总览
parent: homebase-goal
tags: [homelab, dashboard]
---

# 架构总览

## 拓扑

一仓两包，生产模式合并为单端口单容器：

- **`backend/`**（`server-homepage-backend`）— Node ≥ 22、Hono（`@hono/node-server`）、dockerode、tsx 直跑 TS。采集真实主机与服务状态，暴露 JSON API `/api/*`；设置 `STATIC_DIR` 后同一进程兼营静态 SPA（生产单容器模式）。
- **`src/`** — React 19 + Vite + Tailwind CSS 4 + recharts + motion 的 SPA。开发时 Vite `:5173` 把 `/api` 代理到 `:8787`。

## 模块边界与依赖

六个模块（各见独立 spec）；边为代码实测的 import / HTTP 调用：

- **backend-api**（`backend/src/app.ts`、`index.ts`）→ 依赖其余四个后端模块：backend-telemetry、docker-integration、service-catalog、host-facts。唯一允许组合各采集面的地方。
- **backend-telemetry**（`metrics.ts`、`recorder.ts`、`history.ts`）→ 依赖 host-facts：`metrics.ts` 从 `network.ts` 取默认网卡链路速率与 rx/tx 计数器。
- **docker-integration**（`docker.ts`）→ 只依赖 `types.ts`；只经 Docker socket 说话。
- **service-catalog**（`config.ts`、`probe.ts`）→ 只依赖 `types.ts`；只做文件读取与 HTTP 探测。
- **host-facts**（`storage.ts`、`network.ts`、`devices.ts`）→ 无内部依赖，只读采集面。
- **frontend-spa**（`src/`）→ 依赖 backend-api 的 **HTTP JSON 契约**（`src/lib/api.ts` 是唯一出口）；不 import 后端代码。

不存在后端→前端、前端→采集器、采集器互相依赖的边。

## 跨模块不变式

1. **契约唯一**：`/api/*` JSON 进出是前后端唯一耦合面。前端类型在 `src/lib/api.ts` **手工镜像** `backend/src/types.ts`——改后端类型必须同步改前端，二者无编译期联动。
2. **鉴权单开关**：`API_TOKEN` env 优先，否则仓库根 `.api-token` 文件；启用后除 `/api/health` 外所有 `/api/*` 要求 `Bearer`。静态 SPA 永不鉴权（未授权由前端 `TokenGate` 收集 Token）。**默认无鉴权 = 用户确认接受的现状，以「暂时仅内网使用」（goal 受众）为前提**——若未来部署到公网或不可信网络，此前提失效，鉴权必须启用。
3. **主机访问统一前缀**：所有 `/proc`、`/sys`、`/` 读取经 `HOST_PROC` / `HOST_SYS` / `HOST_FS`（容器内挂 `/host/proc` 等；宿主机直跑用默认值）。**`PROBE_HOST` 默认 `host.docker.internal`**，本机开发置 `127.0.0.1`——探测地址（后端视角）与浏览器链接（前端 `service-url.ts` 推导）是两条路径。
4. **机器本机状态**：`services.json`、`devices.json`、`data/`、`~/.caddy/Caddyfile` 不随部署覆盖（原则见 goal）。服务与设备目录**每次请求都重读文件**，编辑热生效；坏文件回退 last-good，永不 500。
5. **历史数据无锁单写**：记录器是唯一写入者（15s 一笔），查询端只读；`DATA_DIR`（默认运行目录 `data/`）下的单文件库 `homebase.db`（`node:sqlite`，WAL 模式）由 recorder 与 history 共享，每日 prune 后 `wal_checkpoint(TRUNCATE)` 保持 `-wal` 极小、文件拷贝备份一致。运行时约束：`node:sqlite` 需 Node ≥ 22.5（需 `--experimental-sqlite` flag，Dockerfile CMD 已带）或 ≥ 23.4（免 flag）。

## 环境旋钮（唯一清单）

| 变量 | 默认 | 使用方 |
| --- | --- | --- |
| `PORT` | `8088` | backend-api 入口 |
| `HOST_PROC` / `HOST_SYS` / `HOST_FS` | `/proc` / `/sys` / `/` | host-facts、backend-telemetry |
| `PROBE_HOST` | `host.docker.internal` | service-catalog |
| `DATA_DIR` | `<cwd>/data` | backend-telemetry |
| `SERVICES_CONFIG` | `backend/config/services.json` | service-catalog |
| `DEVICES_CONFIG` | `backend/config/devices.json` | host-facts |
| `API_TOKEN` / `API_TOKEN_FILE` | （空）/ 仓库根 `.api-token` | service-catalog（读取）、backend-api（执行） |
| `STATIC_DIR` | （空＝纯 API 模式） | backend-api |

## 部署

- **生产（唯一目标）**：Mac mini。`deploy-mini.sh` = rsync → 远端 build → `launchctl kickstart`，服务 `:8088`；Caddy 反代 `mini.home.lan` → `127.0.0.1:8088`。`scripts/backup-data.sh` + `com.homebase.backup.plist` 定期备份 `data/`。
- **Linux/Docker 路径**（`deploy.sh`、`docker-compose.yml`、单容器 `Dockerfile` 同端口）保留但当前无部署目标——用户确认接受的现状。
- 单容器模式缓存策略由 backend-api 的静态层负责：`index.html` 永远 revalidate，`/assets/*` 内容哈希 immutable。

## 测试

vitest 仅覆盖后端（`backend/src/**/*.test.ts`）：config、probe、network、history 单测 + app 路由冒烟。metrics、recorder、docker、storage、devices 目前无测试——**已识别但用户未确认接受为永久现状**（可改进项）。

## 已知漂移（导入时发现，未确认处理方式）

`PORT` 代码默认 `8088`（对齐生产），而 Vite 代理指向 `:8787`、README 快速开始称开发 API 在 `:8787`——本地开发需 `PORT=8787 npm run dev`，否则代理落空。
