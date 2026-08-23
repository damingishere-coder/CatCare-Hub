# 本地免登录与私网风险说明

## 当前默认边界

CatCare-Hub 已按本机单人使用方式取消密码登录。`start.bat` 会让前端 `5180` 和 API `8000` 都只监听 `127.0.0.1`，管理后台和移动执行页面只能从运行应用的这台电脑打开。

| 入口 | 当前访问方式 | 可访问范围 |
| --- | --- | --- |
| `/admin/*`、`/api/admin/*` | 本机免登录 | 客户、猫咪、订单、计划、任务、路线、收款与填写审核 |
| `/mobile/*`、`/api/mobile/*` | 本机免登录 | 今日任务和单任务现场执行 |
| `/fill/:token`、`/api/fill/:token` | 随机填写 Token | 仅该 Token 对应的草稿与单次提交 |
| `/api/health` | 本机匿名 | 仅服务状态，不含业务数据 |

应用不再生成、检查或保存访问码，也不创建登录会话 Cookie。旧 `.env` 里若存在 `CATCARE_ADMIN_PASSWORD_HASH`、`CATCARE_MOBILE_PASSWORD_HASH`、`CATCARE_SESSION_HOURS` 或 `CATCARE_COOKIE_SECURE`，这些字段不会再被代码读取，可在方便时手工删除；不要为了清理配置而读取或复制其中的值。

客户填写 Token 不是后台密码，仍然是客户表单的数据隔离凭据。系统只保存 Token 的 SHA-256 摘要；原文只在生成时返回一次，丢失后无法恢复。

## 仍然保留的请求保护

```text
CATCARE_ALLOWED_HOSTS=...      API 接受的 Host 名称，逗号分隔，不带协议或端口
CATCARE_TRUSTED_ORIGINS=...    允许发起后台写请求的完整 Origin，逗号分隔
```

- `TrustedHostMiddleware` 继续拒绝不受信任的 Host。
- 管理和移动 API 的 POST、PUT、PATCH、DELETE 继续拒绝跨站或不可信 Origin。
- 敏感 API 响应继续使用 `no-store` 等响应头。
- 客户填写 Token 继续在日志中脱敏。

这些措施不能替代身份验证。由于当前没有密码，任何能够访问后台端口的人都等同于拥有完整管理权限。

## 使用限制

1. 使用 `start.bat` 启动，不要自行把 `127.0.0.1` 改成 `0.0.0.0`。
2. 不要在 Windows 防火墙中向局域网或公网开放 `5180`、`8000`。
3. 不要使用 Tailscale Serve、Cloudflare Tunnel、端口转发、反向代理或路由器映射发布整个应用。
4. 如将来需要从手机或另一台电脑访问，应先重新增加身份验证或由外层访问控制限制人员和设备。
5. 只有客户填写页面可在未来考虑单独发布；届时仍必须建立严格的路径白名单，使 `/admin`、`/mobile`、`/api/admin/*`、`/api/mobile/*`、数据库和上传目录对外返回 404。

## 日常处理

- 客户链接误发：在后台关闭该链接并重新生成，不要尝试从数据库恢复 Token 原文。
- 电脑遗失或被他人使用：先依靠 Windows 账号锁屏、磁盘加密和设备管理保护数据；CatCare-Hub 当前没有第二层登录保护。
- 需要跨设备访问：先停止服务并设计新的访问控制方案，不要只修改启动监听地址。
