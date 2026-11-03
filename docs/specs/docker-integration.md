---
id: docker-integration
type: module-design
status: draft
title: backend · Docker 集成
parent: homebase-architecture
---

# backend · Docker 集成

## 职责

`backend/src/docker.ts`：Docker socket 的唯一封装层（dockerode）。四件事：

1. **容器清单** `listContainers()` — id / 名称 / 镜像 / 状态 / 端口 + 每容器 CPU%、内存用量与占比（从 `docker stats` 流式数据换算）；`LIST_CACHE_MS = 2000` 进程内缓存。
2. **状态映射** `containerStateMap()` — 名称 → 状态（`running` / `exited` …），供服务目录把 `probe:false` 服务的状态锚在容器上（组合在 backend-api `/api/services`）。
3. **日志与控制** `containerLogs(name, 200)` 尾部日志文本；`controlContainer(name, action)` 执行 start / stop / restart（action 白名单在 backend-api 收口）。失败抛错，由路由层转 503。
4. **服务自动发现** `discoverServices(manual)` — 运行中且**发布了端口**的容器即服务；图标 `iconKey` 由镜像名经 `IMAGE_HINTS` 正则表推断（如 `ghcr.io/immich-app/immich-server` → immich），未知落回 `container`；配色从 `AUTO_COLORS` 调色板（`#00E5FF`、`#A855F7`、`#22C55E`、`#F59E0B`、`#3B82F6`）按序取。**manual 优先、对 manual 去重**的不变式归 [服务目录](service-catalog.md)，组合发生处归 backend-api。

## 边界

只依赖 `types.ts` 与 dockerode；只经 Docker socket 说话。被 backend-api 独家调用。发现结果只是候选目录条目，不含探测状态（那是 service-catalog 的事）。

## 已知现状

无单元测试（需真实 Docker socket）；手工验证路径为 `/api/containers` 与 `/api/services`。
