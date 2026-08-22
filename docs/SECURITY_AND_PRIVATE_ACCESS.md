# P12 安全与私网访问说明

## 默认边界

CatCare-Hub 默认是本机应用。`start.bat` 同时启动前端 `5180` 和 API `8000`，但“端口能被访问”不等于“适合公开部署”。P12 的登录与权限隔离用于减少误访问和越权风险，不替代 HTTPS、防火墙、反向代理、系统补丁和备份。

| 入口 | 身份 | 可访问范围 |
| --- | --- | --- |
| `/admin/*`、`/api/admin/*` | admin | 客户、猫咪、订单、计划、任务、路线、收款与填写审核 |
| `/mobile/*`、`/api/mobile/*` | admin 或 mobile | 今日任务和单任务现场执行；不能访问后台管理 API |
| `/fill/:token`、`/api/fill/:token` | 随机填写 Token | 仅该 Token 对应的草稿与单次提交 |
| `/api/health` | 匿名 | 仅服务状态，不含业务数据 |

访问码原文不落库、不写 `.env`，浏览器会话使用 `HttpOnly`、`SameSite=Strict` Cookie，服务端只保存会话 Token 的 SHA-256 哈希。客户填写 Token 同样只保存哈希；生成后若没有及时复制，系统无法恢复原文。

## 本地配置项

`setup.bat` 自动写入被 Git 忽略的 `.env`。不要把真实值复制到 `.env.example`。

```text
CATCARE_ADMIN_PASSWORD_HASH=       管理员访问码的 PBKDF2-SHA256 哈希
CATCARE_MOBILE_PASSWORD_HASH=      执行端访问码的 PBKDF2-SHA256 哈希
CATCARE_SESSION_HOURS=12           会话有效小时数，范围 1-720
CATCARE_COOKIE_SECURE=false        仅 HTTPS 入口必须改为 true
CATCARE_ALLOWED_HOSTS=...          API 接受的 Host 名称，逗号分隔，不带协议/端口
CATCARE_TRUSTED_ORIGINS=...        允许发起写请求的完整 Origin，逗号分隔
```

修改访问码时使用交互式命令，不把原文放在参数、脚本或聊天记录中：

```powershell
.\.venv\Scripts\python.exe backend\scripts\manage_access.py --reset admin
.\.venv\Scripts\python.exe backend\scripts\manage_access.py --reset mobile
```

如果 `.env` 缺少有效哈希，`start.bat` 会拒绝启动；应用没有默认密码或跳过认证的生产后门。

## 可信私网：Tailscale 方向

推荐只让已加入同一 tailnet 且通过 ACL 授权的设备访问。Tailscale 官方说明 `tailscale serve` 可将本机服务通过 tailnet 内的 HTTPS 地址反向代理，访问控制规则同样适用；它与面向公网的 Funnel 是不同功能。参考 [Tailscale Serve 官方说明](https://tailscale.com/docs/features/tailscale-serve) 和 [CLI 参考](https://tailscale.com/docs/reference/tailscale-cli/serve)。

实施前应完成：

1. 备份本地数据库，并确认 Windows 防火墙没有直接向不可信网络开放 5180/8000。
2. 使用 Tailscale Serve 只代理 `http://127.0.0.1:5180`，不要使用 Funnel。
3. 将生成的 `设备名.tailnet名.ts.net` 加入 `CATCARE_ALLOWED_HOSTS`，将完整 `https://设备名.tailnet名.ts.net` 加入 `CATCARE_TRUSTED_ORIGINS`。
4. 设置 `CATCARE_COOKIE_SECURE=true`，重新启动应用，并分别验证 admin/mobile 权限矩阵与注销。
5. 使用 tailnet ACL 限制可访问该设备/服务的人员和设备；不要仅依赖 CatCare-Hub 访问码。

P12 只准备上述配置边界，没有自动安装 Tailscale、修改防火墙、创建 ACL 或执行 Serve 命令。

## 未来公网客户填写：Cloudflare Tunnel 方向

只有客户填写页面可以考虑公网发布；管理与执行入口必须保持 404/不可路由。Cloudflare 官方配置支持按 hostname 与 path 正则从上到下匹配 ingress，并要求最后有 catch-all 规则，因此可以用“明确白名单 + 最终 404”建立正向边界。参考 [Cloudflare Tunnel 配置文件与 ingress 规则](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)。

由于 `/fill/:token` 的生产页面还需要前端 JS/CSS，并会调用 `/api/fill/:token`，未来 ingress 白名单至少包括：

```yaml
ingress:
  - hostname: fill.example.com
    path: ^/fill(?:/.*)?$
    service: http://127.0.0.1:5180
  - hostname: fill.example.com
    path: ^/api/fill(?:/.*)?$
    service: http://127.0.0.1:5180
  - hostname: fill.example.com
    path: ^/assets/.*$
    service: http://127.0.0.1:5180
  - service: http_status:404
```

该片段只是无凭据示例，不能直接部署。正式实施还必须：

- 使用 `npm run build` 后的生产资源，不把 Vite 开发服务器作为公网服务。
- 明确把公网 hostname 加入 Host 配置；客户填写 API 本身不需要 admin/mobile Cookie。
- 验证 `/admin`、`/mobile`、`/api/admin/*`、`/api/mobile/*`、`/api/auth/*`、`/sw.js`、数据库与上传目录均返回 404，且静态资源白名单没有通配到整个站点。
- 在 Cloudflare 侧增加速率限制、机器人/滥用防护和日志脱敏；Tunnel 配置、凭据文件和证书绝不进入本仓库。
- 用官方 `cloudflared tunnel ingress validate` 和 `cloudflared tunnel ingress rule <URL>` 检查每一条允许与拒绝路径后，再由人工决定是否上线。

P12 不创建 Tunnel、不安装 `cloudflared`、不申请域名、不修改 DNS，也不对任何外部服务执行写入。

## 事件处理与日常习惯

- 访问码疑似泄漏：立即重置对应角色访问码，并执行 `stop.bat`、`start.bat` 重启；重启后旧会话的凭据指纹不再匹配，会在下次请求时自动失效。当前不要手工改业务数据库。
- 客户链接误发：在后台关闭该链接并新建，不要尝试从数据库恢复 Token 原文。
- 设备遗失：先在 Tailscale/系统层撤销设备，再重置 mobile 访问码。
- 每次对外访问方案变更后，重新验证匿名/admin/mobile/fill 四类身份矩阵和所有 404 路径。
