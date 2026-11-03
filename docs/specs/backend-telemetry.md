---
id: backend-telemetry
type: module-design
status: draft
title: backend · 遥测管线（采样→记录→查询）
parent: homebase-architecture
dependsOn: [host-facts]
---

# backend · 遥测管线（采样→记录→查询）

## 职责

四个文件组成一条单向流水线：**采样（1s）→ 记录（15s）→ 查询（按窗口降采样）**。

- **`metrics.ts` — 采样器**。每秒 tick（`setInterval(tick, 1000).unref()`）读主机：CPU（/proc/stat 差分）、内存（/proc/meminfo）、负载、进程数、TCP 连接数、温度（/sys class thermal，Darwin 走 `sysctl` 等）、uptime、网卡 rx/tx 速率与默认网卡链路速率 `netMaxMbps`（仪表盘量表以它为满刻度）、主机身份（容器内从 hostfs 挂载读 `/etc`，否则只见容器自己）。结果进程内快照缓存，`getSnapshot()` 直接返回最近一笔。**Darwin 回退**是硬性需求：同一份代码要能在开发 Mac 上跑（`vm_stat` / `ps` / `netstat` / `sysctl`）。
- **`store.ts` — SQLite 存储层**。`node:sqlite` 句柄唯一归属（2025-11 由 JSONL 切换而来，用户确认：动机 = 查询聚合更稳 / 备份迁移更简 / 保留期与粒度弹性 / 为未来铺路）。库文件 `DATA_DIR/homebase.db`，WAL + `synchronous=NORMAL`；宽表 `samples(t, cpu, mem, disk, rx, tx, load, tcp, temp)`——t 为 epoch-ms 普通列 + 索引（不作主键：快速重启同毫秒双写不可丢行），8 指标全可空；`meta` 表存放迁移标记。导出 `insertSample` / `rowsSince` / `deleteSamplesBefore` / `checkpoint` / `sampleCount`。启动即 `mkdir DATA_DIR` 并建表；`node:sqlite` 不可用时抛清晰错误（Node ≥ 22.5 需 `--experimental-sqlite`，Dockerfile CMD 已带；≥ 23.4 免 flag）。
- **`recorder.ts` — 落盘器**。每 15s（`SAMPLE_MS`）预编译 INSERT 一笔；best-effort 语义不变：失败每分钟最多警告一次，实时指标不受影响。`prune()` 删除 30 天（`RETENTION_DAYS`）前旧行，随启动与每 24h 执行，随后 `wal_checkpoint(TRUNCATE)`（`-wal` 保持极小，文件拷贝备份一致）。唯一写入者，无锁。
- **`history.ts` — 查询端**。只读 SQLite。`querySeries(window)` 按 `1h/6h/24h/7d` 降采样为约 300 桶：SQL `GROUP BY` 桶均值（SQLite `AVG` 天然忽略 NULL，与旧 JSONL 行为一致），JS 侧保桶脚手架（空桶 `null`、`points[i].t = from + i*step`）保证响应形状不变；`queryAggregate()` 取 7 天原始行后在 JS 做日历日/小时聚合——**日历分组留在 JS 是刻意的**：日界依赖容器本地 TZ（Asia/Shanghai），SQLite 无 TZ 概念，且 7d 仅约 4 万行（<10ms），下 SQL 是负收益。rate 键按 `SAMPLE_SEC=15` 换算回总量。窗口键白名单在 backend-api 校验，本模块假定输入合法。

## 边界

只经 `HOST_PROC` / `HOST_SYS` / `DATA_DIR` 触碰世界；对 host-facts 的唯一依赖是 `network.ts` 的默认网卡与计数器（import 边，架构图已记录）。不触 Docker、不触 glances、除 `homebase.db`（含 `-wal`/`-shm`）外不写任何文件。

## 决策

- **内嵌 SQLite（推翻旧「无数据库 JSONL」决策，2025-11 用户确认）**：零新依赖（Node 内建 `node:sqlite`）、单文件可 rsync 备份、聚合下 SQL 更稳、保留期/粒度此后改常量即可。WAL 模式下单写者 + 每日 checkpoint 兜住备份一致性。
- **存量迁移走显式脚本**：`backend/src/migrate-history.ts`（`npm run migrate:history`）事务导入全部遗留 `hist-*.jsonl`（跳坏行，同旧读取器容忍度），`meta.imported_at` 标记防重跑；验证图表后手删旧文件。拒绝启动时自动导入——隐式写库不可预测。
- **采样与记录频率解耦**（1s 看现在 / 15s 存历史）：仪表盘实时性不牺牲，落盘量降为 1/15。粒度与保留期维持 15s / 30 天（弹性已获得，调值另行任务）。
- **仅历史存储入库**：`services.json` / `devices.json` / `.api-token` 保持文件——手改即热生效的语义优先于存储统一（用户确认）。

## 已知现状

`store.ts`、`history.ts` 有单测（fixture 在 import 前经 store 写入/设 `DATA_DIR`）；`metrics.ts`、`recorder.ts` 无单测（Darwin/Linux 双路径手工验证）。存量迁移脚本仅在合成 fixture 上端到端验证过；真实 JSONL 的首次导入在部署时执行。
