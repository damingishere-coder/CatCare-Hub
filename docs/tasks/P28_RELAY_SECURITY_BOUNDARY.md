# P28 Relay 安全与交付边界

## 背景

第二次工程复检确认，公网填写链路仍有四组值得立即收口的问题：Relay 处理中租约重领不是数据库原子写、公开请求在未知长度时可能无上限缓冲、Windows 到 NAS 的 Relay Bearer 仍走局域网明文 HTTP，以及正式 `/f/{token}` 与 CloudBase 静态回退文档不一致。

本任务是既定整改计划的第二阶段，必须保持为独立、可审查、可回滚的 PR。

## 目标

- 将 Relay `processing` 状态重领改为数据库条件更新，确保并发请求只有一个成功。
- 对公开填写写请求执行最多 256 KiB 的有界读取，不在检查前无上限缓冲请求体。
- 本机 Relay 客户端拒绝向非回环明文 HTTP 地址发送 Bearer。
- Synology Relay 管理端口只绑定 NAS 回环，由 Tailscale Serve 在 tailnet 内提供 HTTPS；公网 Funnel 继续只指向 Gateway。
- 同步 `/f/*` 与 `/fill/*` 的静态托管契约和设备侧验收步骤。

## 允许修改范围

- `backend/app/services/intake.py`
- `backend/app/services/intake_relay_security.py`
- `backend/app/services/intake_remote.py`
- `backend/tests/test_intake_relay.py`、`backend/tests/test_intake_remote.py`
- `deploy/synology/compose.yaml`、`deploy/synology/.env.example`
- `deploy/synology/README.md`、`deploy/cloudbase/README.md`
- 与上述边界直接相关的部署契约测试
- 本任务文件

## 禁止修改范围

- 本机管理 API 的认证体系、订单/任务/财务业务逻辑
- 真实 NAS、Tailscale、Windows 防火墙、证书、CloudBase 资源和公网状态
- PostgreSQL、备份容器、脱敏 Worker 健康语义（留给 PR3）
- UI 回归、包体、依赖升级、God Component 和低价值清理
- `.env`、Secret、Token、私钥、证书内容、审计报告与 Codemap 产物

## 已确定实现要求

1. Relay 重领必须使用 `UPDATE ... WHERE status/revision/idempotency_key/decision_mode` 并检查 `rowcount`；冲突返回 `409`，失败请求不得覆盖成功请求的 claim token。
2. 公开写请求即使缺少或伪造 `Content-Length`，也只能读取到上限加一个字节；超限立即返回 `413`，可接受请求必须可由下游正常读取。
3. `CATCARE_INTAKE_RELAY_URL` 只允许 HTTPS；仅 `localhost`、`127.0.0.1`、`::1` 可在本地测试或回环代理场景使用 HTTP。
4. Synology Compose 不再把 Relay 绑定到 NAS LAN IP；只发布到 `127.0.0.1`。设备侧通过 `tailscale serve --https=8443 --bg http://127.0.0.1:<relay-port>` 提供 tailnet 内 TLS。
5. 公网 Funnel 与管理 Serve 必须使用不同端口；公网入口仍只允许 Gateway 白名单，管理路由不得进入 Funnel。
6. 仓库只提供配置和验收说明，不自动执行设备命令。真正修改 NAS/Tailscale/防火墙或公网更新前必须重新确认。
7. CloudBase 文档必须同时要求 `/f/*` 和 `/fill/*` 回退到 `index.html`。

## 验收标准

- 两个会话用同一 processing revision 重领时，恰好一个成功，另一个 `409`；成功 token 可完成租约。
- 无长度或伪造长度的分块请求超过 256 KiB 时返回 `413`，且应用不会先缓存完整超大请求。
- 非回环 `http://` Relay URL 在发送凭据前被拒绝；HTTPS 与回环 HTTP 保持可用。
- Compose 渲染后 Relay 只绑定 `127.0.0.1`，Gateway 仍只绑定 `127.0.0.1`，PostgreSQL 无宿主机端口。
- `/f/*`、`/fill/*`、公开 API 和管理路由拒绝契约有自动化或静态配置证据。
- 全量后端测试、前端测试、lint、类型检查和双构建通过。
- Git diff 不包含范围外修改、Secret、调试代码或部署产物。

## 测试命令

- `.venv\\Scripts\\python.exe -m pytest backend/tests/test_intake_relay.py backend/tests/test_intake_remote.py -q`
- `.venv\\Scripts\\python.exe -m pytest backend/tests -q`
- `npm --prefix frontend test -- --run`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend run build`
- `npm --prefix frontend run build:public`
- `docker compose --env-file deploy/synology/.env.example -f deploy/synology/compose.yaml config --quiet`

## 返回格式

- 修改摘要与安全边界变化
- 测试和配置渲染的准确结果
- 设备侧仍待执行的步骤和中断风险
- Git 分支、提交、远端 SHA、PR 和 CI 状态
- 明确声明未修改真实 NAS、Tailscale、防火墙、CloudBase 或生产数据库，且未自动合并本 PR
