# P23 群晖 CatCare 公网填写服务

## 背景

P22 已提供独立公开填写构建、FastAPI 中转、PostgreSQL 限定、Token 哈希、提交锁定、本地审核/作废/归档及 30 天敏感内容清理。本任务只把这条链路部署到用户自有群晖 NAS；本地管理后台和正式 SQLite 永不进入公网容器。

## 目标

- 在群晖 8T 存储空间的专用目录中运行公开网关、填写中转、独立 PostgreSQL 和每日备份。
- Tailscale Funnel 只转发 NAS 回环地址上的公开网关。
- 本地 CatCare 仅通过局域网管理端口和 Bearer Secret 同步中转数据。

## 允许修改

- `deploy/synology/`
- `.dockerignore`
- 本任务文档

## 禁止修改

- 本地管理后台、订单、财务、客户档案业务路由和正式 SQLite 数据。
- 用户现有 `.env`、密钥、Token、Cookie、证书、NAS 凭据和共享文件。
- `.codemap/`、`PROJECT_AUDIT.md` 及其他未提交工作。

## 已确定实现要求

- 三层隔离：公开 Nginx 网关、FastAPI 中转、PostgreSQL；数据库不映射宿主机端口。
- 公网网关只允许 `/f`、`/f/:token`、兼容旧链接的 `/fill`、`/fill/:token`、静态资源、`/api/fill/*`、`/api/health`、`/api/ready`。
- `/api/admin/*` 只能从 NAS 局域网绑定端口访问，且继续要求服务端 Bearer Secret。
- Secret 使用 Compose Secret 文件；真实值只生成到被 Git 忽略的运行目录。
- 本机先构建公开前端，并用锁定的 Linux wheels 离线安装中转依赖；再使用已缓存的官方基础镜像构建四个最终镜像，导出带 SHA-256 校验文件的 TAR。NAS 只导入最终镜像，不上传项目源码或连接软件源。
- 容器使用非 root 应用用户（数据库初始化和备份所需的最小例外除外）、健康检查、日志轮转、资源限制和自动恢复。
- PostgreSQL 每日生成 custom-format 备份并保留 7 天；备份目录不进入公网网关。
- Funnel 保持关闭，直到内部健康检查和路由拒绝测试通过，并由用户再次确认公开影响。

## 验收标准

- Compose 配置可解析，公开前端可构建，后端测试通过。
- PostgreSQL、API、网关和备份容器均健康；数据库未公开宿主机端口。
- 公网网关对 `/admin`、`/api/admin/*`、订单、财务和移动端 API 返回 404。
- 公开表单可保存和提交；提交后原链接锁定；本地后台可同步、审核、作废和归档。
- 备份文件实际生成并可由 `pg_restore --list` 读取。
- 仅在用户最终确认后启用 Funnel，再用关闭 Wi-Fi 的手机完成 HTTPS 和微信宽度验收。

## 测试命令

```powershell
docker compose --env-file .runtime/catcare-synology/bundle/.env -f .runtime/catcare-synology/bundle/compose.yaml config
.\deploy\synology\scripts\Build-CatCareSynologyImages.ps1
Set-Location backend; ..\.venv\Scripts\python.exe -m pytest tests -q
Set-Location ..\frontend; npm run build:public
```

## 返回格式

报告 NAS/DSM/架构/资源、Container Manager/Tailscale 版本、容器健康、公网地址与拒绝面、真实表单链路、自动恢复、备份可读性以及仍存风险；不得把配置存在等同于公网或交付成功。
