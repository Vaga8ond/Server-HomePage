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
3. **日志与控制** `containerLogs(name, tail = 200, since?)` 尾部日志文本（`since` 为 unix 秒，透传 docker 只取该时刻之后），**`timestamps: true`** — dockerode 每行前缀 RFC3339Nano 时间戳，demux 后原样返回，时间列真值由前端 `parseLine` 剥离（多行堆栈续行无前缀，落 `INFO`/无时间）；`streamContainerLogs(name, tail, onLine)` follow 流的**增量 demux**（8 字节帧头跨 chunk 缓存；帧类型字节非法 → tty 原文透传；同款 ANSI 剥离），按完整行回调 `onLine(stream, line)`，返回 cancel 销毁函数；`streamMergedLogs(names, tail, onLine)` 并发 follow 多容器，每行附容器名（打不开的容器静默跳过）；`listComposeProjects()` 运行中容器按 compose label `com.docker.compose.project` 分组（无 label 时按名称模式 `<project>-<service>-<index>` 推导，独立容器无项目被排除），进程内 5s 缓存；`controlContainer(name, action)` 执行 start / stop / restart（action 白名单在 backend-api 收口）。失败抛错，由路由层转 503。
4. **服务自动发现** `discoverServices(manual)` — 运行中且**发布了端口**的容器即服务；图标 `iconKey` 由镜像名经 `IMAGE_HINTS` 正则表推断（如 `ghcr.io/immich-app/immich-server` → immich），未知落回 `container`；配色从 `AUTO_COLORS` 调色板（`#00E5FF`、`#A855F7`、`#22C55E`、`#F59E0B`、`#3B82F6`）按序取。**manual 优先、对 manual 去重**的不变式归 [服务目录](service-catalog.md)，组合发生处归 backend-api。
5. **事件流监听**（`docker-events.ts`，独立于 `docker.ts`）— `getEvents({ type: ["container"] })` 持续流，白名单 `start / die / oom / health_status`（health 的子状态如 `health_status: healthy` 进 `detail`），按 `Actor.Attributes.name` 归容器、无名事件丢弃，best-effort 写 `events` 表；断线 error/end/close 去抖后每 5s 重连（timer `unref`），Docker socket 不可用只是时间线为空，不影响启动。app.ts 启动时拉起。

## 边界

只依赖 `types.ts` 与 dockerode；只经 Docker socket 说话。被 backend-api 独家调用。发现结果只是候选目录条目，不含探测状态（那是 service-catalog 的事）。

## 已知现状

无单元测试（需真实 Docker socket）；手工验证路径为 `/api/containers` 与 `/api/services`。`docker-events.ts` 例外：事件过滤/入库/查询有单测（不依赖 socket），经 `/api/events` 手工验证。
