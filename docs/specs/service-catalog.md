---
id: service-catalog
type: module-design
status: draft
title: backend · 服务目录与探测
parent: homebase-architecture
---

# backend · 服务目录与探测

## 职责

`backend/src/config.ts` + `probe.ts`：目录语义与「在线吗」的判定。

### config.ts — 目录与凭据

- `readServices()` **每次调用都重读** `SERVICES_CONFIG`（默认 `backend/config/services.json`）——编辑热生效，无需重启。坏文件（mid-edit、坏 JSON、`services[]` 缺失）回退 **last-good 目录**，畸形条目逐条丢弃（每分钟最多警告一次）——目录永不 500。
- 条目校验底线：`name: string` + `port: number` 即收录；其余字段（`scheme` / `container` / `url` / `probe` / `iconKey` / `color` / `category`）可选。
- `apiToken()` — `API_TOKEN` env 优先，否则读 `API_TOKEN_FILE`（默认仓库根 `.api-token`）；结果进程内缓存。都没有 → API 开放（用户确认接受的现状，架构不变式 2）。
- `probeUrl(svc)` — `svc.url` 显式覆盖，否则 `scheme://PROBE_HOST:port`。**探测地址是后端视角**；浏览器点击链接由前端推导（frontend-spa），两条路径互不借用。

### probe.ts — 探测

- `probeAll(services)`：并发 HTTP(S) GET，5s 结果缓存（`CACHE_MS`）、3s 超时（`TIMEOUT_MS`）。
- 判定：任何响应（随后立即 `destroy()`）= `running` + 延迟；`ECONNREFUSED` = `stopped`；其余错误 / 超时 = `error`。
- **决策：`rejectUnauthorized: false` 是故意的**——homelab 服务普遍自签证书，只关心「应答了吗」，不关心谁签的；仅限 LAN URL。
- `probe: false` 的条目（无 HTTP 面的数据库等）跳过探测；真实状态由映射容器状态推导——**推导发生在 backend-api**（`/api/services`），本模块的占位状态永不该被展示。

### 目录合成不变式（组合处 backend-api）

手动条目在前（携带人工元数据），发现条目在后且对 manual 去重——**手动永远赢**。

## 边界

只依赖 `types.ts`；只做文件读取与出站 HTTP。不触 Docker socket（发现是 docker-integration 的事）。

## 已知现状

`config.ts` 有单测（last-good 回退、畸形条目）；`probe.ts` 有单测（判定矩阵）。
