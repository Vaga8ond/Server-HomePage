---
id: homebase-goal
type: goal-and-requirements
status: draft
title: HomeBase · 目标与需求
tags: [homelab, dashboard]
---

# HomeBase · 目标与需求

## 目标

自托管 homelab 服务器首页：一个页面回答「服务都在线吗，这台机器健康吗」。

## 问题

homelab 的服务散落在各个容器里，状态分散在 Docker CLI、htop、df 等工具之间；现成方案要么要在每台被监控机器上装 agent，要么要数据库和成套配置文件。

## 受众

作者本人。部署目标是固定的 Mac mini（`192.168.12.53`，launchd 托管，Caddy 反代 `mini.home.lan`），外加一台 NAS 作为外部设备展示；浏览器访问。**项目暂时仅在内网使用，不对外网暴露**（用户确认，2025-11）——这也界定了当前的风险模型：可信 LAN。ghcr.io 镜像与双语 README 是开源副产品——**定位为个人自用为主，不为外部兼容性牺牲简洁**。

## 能力（代码现状）

- **零配置服务目录** — 运行中且发布了端口的 Docker 容器自动发现（图标与配色由镜像名推断）；`backend/config/services.json` 手动条目优先于发现，携带人工元数据（名称、分类、图标、颜色、容器映射）。
- **真实主机指标** — CPU / 内存 / 负载 / TCP 连接 / 温度 / 运行时长 / 网卡计数每秒采样，读 PID 1 的 `/proc`、`/sys`（容器内经 `HOST_PROC` / `HOST_SYS` 挂载），Darwin 回退（`vm_stat` / `ps` / `netstat` / `sysctl`），同一份代码在 Mac 上可开发。
- **30 天历史** — 每 15 秒写入内嵌 SQLite（`data/homebase.db`，零依赖的 `node:sqlite`）；查询时按窗口（1h / 6h / 24h / 7d，各约 300 桶）在 SQL 内降采样，驱动迷你图、流量面积图、周柱状图与 GitHub 风格热力图。旧 JSONL 历史可用 `npm run migrate:history` 一次性导入。
- **容器控制** — 每容器 CPU / 内存、日志流（前端做级别解析与过滤）、start / stop / restart 直连 Docker socket。
- **存储与网络视图** — `statfs` 真实挂载（过滤虚拟文件系统）、接口链路状态 / 速率 / 地址 / 开机累计流量。
- **外部设备** — NAS 经 glances REST API（`:61208`）展示 CPU / 内存 / 温度 / 文件系统；无 glances 的设备降级为纯连通性检查。
- **可选鉴权** — 配置 Bearer Token 后，`/api/health` 之外的一切 `/api/*` 都要求 `Authorization` 头。
- **前端体验** — 暗 / 亮主题、hash 深链接（刷新与前进后退存活）、250ms 方向感知视图过渡、图表跟随主题、尊重 `prefers-reduced-motion`。

## 非目标（用户确认）

- **告警 / 通知** — 不做阈值告警、邮件 / Telegram 等推送；只展示现状。
- **多用户 / 权限体系** — 只有单一可选 Token；无账号、角色、按用户视图。

其余（如存储引擎、外部设备采集方式）既未列入也未排除，是开放项，不是禁止项。

## 原则

1. **无 agent、零必需配置**——挂上 Docker socket 就能跑；本机直跑时连挂载都不需要。历史数据用 Node 内建 `node:sqlite`（零新依赖），仍是「一个进程 + 一个数据目录」的零运维形态。
2. **后端是唯一事实来源**，前端只渲染被告知的内容（见 [架构总览](architecture.md) 的契约不变式）。
3. **机器本机状态永不被部署覆盖**——`backend/config/services.json`、`backend/config/devices.json`、`data/`、`~/.caddy/Caddyfile` 是每台服务器自己的东西。
