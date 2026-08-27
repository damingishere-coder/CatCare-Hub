# CatCare 微信填写 CloudBase 部署说明

本目录只保存不含密钥的部署骨架。CloudBase 环境、PostgreSQL、云托管服务、静态托管和计费资源尚未创建；真实创建和部署前必须再次展示地域、规格、域名和预计费用并取得当次确认。

## 产物边界

- `frontend/dist-public/`：独立公开填写页，只包含 `/fill/:token`，不打包管理后台路由。
- `deploy/cloudbase/intake-relay/Dockerfile`：只启动 `app.intake_relay:app`；对公网挂载公开填写 API，并用服务端 Bearer 凭据保护同步 API。
- 本机 `app.main:app`：继续只监听 `127.0.0.1`，管理后台、客户、订单、任务和财务 API 均不得映射到公网。

## 构建

公开页构建时必须把 CloudBase Run 的默认 HTTPS 地址写入构建环境，不能提交到源码：

```powershell
$env:VITE_API_BASE_URL='https://待确认的云托管默认域名'
npm run build:public --prefix frontend
```

容器构建上下文必须是项目根目录：

```powershell
docker build -f deploy/cloudbase/intake-relay/Dockerfile -t catcare-intake-relay:local .
```

## 云端环境变量

以下变量只在 CloudBase Run 服务端配置，不写入 Git：

| 变量 | 用途 |
| --- | --- |
| `CATCARE_DATABASE_URL` | CloudBase PostgreSQL 的 `postgresql+psycopg://...` 连接串 |
| `CATCARE_INTAKE_RELAY_KEY` | 本机与云端共享的高强度随机服务凭据 |
| `CATCARE_PUBLIC_FILL_ORIGIN` | 静态托管的唯一 HTTPS Origin，不带路径 |
| `CATCARE_RELAY_ALLOWED_HOSTS` | 云托管默认域名或已确认自定义域名 |
| `CATCARE_INTAKE_RELAY_SERVER=1` | 强制云端中转运行模式 |
| `CATCARE_RELAY_AUTO_MIGRATE=1` | 启动时在 PostgreSQL advisory lock 下执行 Alembic |
| `CATCARE_RELAY_BACKGROUND_CLEANUP=1` | 启动后立即清理到期资料，并每 6 小时重试 |

容器启动会拒绝 SQLite，仅允许专用 PostgreSQL。清理采用数据库条件更新；多个实例同时运行也只会清除仍处于到期终态的记录。日志不输出 Token、Payload、联系方式或服务凭据。

## 本机环境变量

以下变量只配置在运行本机 FastAPI 的环境中：

| 变量 | 用途 |
| --- | --- |
| `CATCARE_INTAKE_RELAY_URL` | CloudBase Run 的 HTTPS 地址 |
| `CATCARE_INTAKE_RELAY_KEY` | 与云端一致的服务凭据，浏览器不可见 |
| `CATCARE_PUBLIC_FILL_ORIGIN` | 微信填写页的静态托管 HTTPS Origin |

配置后，浏览器仍只调用本机 `/api/admin/intake/*`；本机 FastAPI 才会在服务端携带凭据访问云端。归档按 Submission UUID 在本机建立唯一回执，云端完成回写失败时可使用相同幂等键重试，不会重复创建客户、订单或任务。

## 静态托管要求

- 上传 `frontend/dist-public/`，将所有 `/fill/*` 回退到 `index.html`。
- 只允许公开页 Origin 调用 CloudBase Run；不要使用 `*` CORS。
- 首次联调可使用平台默认 HTTPS 域名，第一版不创建公众号或小程序资源；CloudBase 官方说明默认 HTTP 访问域名仅适合开发测试，正式对客前应换成已备案自定义域名，避免安全提示中间页和默认域名限制。
- 公网检查必须确认 `/admin`、`/mobile`、`/api/admin/customers`、`/api/orders` 等路径均不可访问。

## 首次资源配置建议（部署前仍须确认计费）

- 地域使用控制台当前支持 PostgreSQL、云托管和静态托管的上海 `ap-shanghai`；截至 2026-08-26，CloudBase 官方地域说明明确表示广州不支持这些能力，不能按原计划强行选广州。部署时仍以实际控制台为最终依据。
- CloudBase Run 初次使用平台可选的最小规格（优先 0.25 核 / 0.5 GiB），最小实例数 1、最大实例数 1。保持一个实例是为了让 30 天清理任务按期运行；当前请求限流同时按 IP 和 Token 执行，并且是单实例内存窗口。
- 开启平台健康检查，路径使用 `/api/ready`；数据库未迁移完成时必须保持 503，不接收流量。
- PostgreSQL 实际 CPU/容量、云托管实例规格、静态托管容量和平台默认 HTTPS 域名均以实际创建页面为准；执行创建前必须截取购买页的套餐、资源点、按量开关和预计费用再次确认。
- 若后续需要扩到多个实例，先把限流状态迁移到共享存储，再提高最大实例数。

当前依据：[CloudBase 地域](https://cloud.tencent.com/document/product/876/51107)、[资源点价格](https://cloud.tencent.com/document/product/876/127357)、[云托管计量](https://cloud.tencent.com/document/product/876/120342)、[HTTP 访问默认域名限制](https://cloud.tencent.com/document/product/876/130728)。

## 部署后验收

部署后按 P22 任务文档执行两条独立提交：一条“仅归档客户”，一条“归档并生成订单”。还要验证电脑关机时微信仍能打开并提交、原链接终态、版本冲突、重复提交、回写失败重试、精确 CORS、限流、无缓存响应和 30 天清理最小回执。
