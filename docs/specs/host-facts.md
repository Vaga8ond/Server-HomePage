---
id: host-facts
type: module-design
status: draft
title: backend · 主机事实采集（存储/网络/外部设备）
parent: homebase-architecture
---

# backend · 主机事实采集（存储/网络/外部设备）

## 职责

三个互不依赖的只读采集面，全部请求-响应式（无采样循环）：

- **`storage.ts`** — `listMounts()`：`statfs` 真实文件系统挂载（总量/已用/占比）；`VIRTUAL_FS` 集合过滤（tmpfs、proc、docker 虚拟盘等）。路径经 `HOST_PROC` / `HOST_FS` 解析。
- **`network.ts`** — `listInterfaces()`：接口名 / 链路状态 / 速率（Mbps）/ IPv4+IPv6 地址 / 开机累计 rx+tx（/sys class net）；`defaultInterface()`：默认路由网卡。**是 backend-telemetry 的依赖**（采样器取速率基数与计数器），也被 backend-api 直接暴露为 `/api/network`。
- **`devices.ts`** — 外部设备（NAS 等）面板。`DEVICES_CONFIG`（默认 `backend/config/devices.json`），同样的「每次重读 + last-good 回退」模式（见架构不变式 4）。有 `glancesUrl` 的设备走 glances REST（`:61208`）取 CPU / 内存 / 温度 / 负载 / uptime / 文件系统；没有的降级为纯连通性检查（`online` 即全部）。结果 5s 缓存（`CACHE_MS`）、单请求 3s 超时（`TIMEOUT_MS`）。

## 边界

无内部依赖；只读（`devices.ts` 的 5s 缓存是本模块唯一状态）。消费方：backend-api（三个只读路由）与 backend-telemetry（仅 `network.ts`）。**被监控机不装 agent** 是设备面的隐含约束——数据要么来自 glances 现成 REST，要么干脆不取。

## 已知现状

`network.ts` 有单测；`storage.ts`、`devices.ts` 无测试（需真实挂载点 / glances 实例）。
