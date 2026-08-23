# 本地免登录改造任务

## 背景

当前 CatCare-Hub 为管理员后台与移动执行端提供访问码、会话 Cookie 和角色隔离。用户明确要求该实例仅在自己的电脑本地运行，并完全取消密码登录。

## 目标

1. 启动后直接进入管理后台，不显示登录页，也不请求登录或会话 API。
2. 管理后台与移动执行端 API 无需 Cookie、访问码或角色即可使用。
3. 删除访问码初始化、启动检查、会话模型和退出入口。
4. 前后端默认仅监听 `127.0.0.1`，降低免登录后台被局域网误访问的风险。
5. 保留客户填写链接的随机 Token、Token 哈希、有效期和数据隔离。
6. 保留 Trusted Host、可信 Origin、敏感响应头和填写 Token 日志脱敏。

## 允许修改范围

- `backend/app/`、`backend/migrations/`、`backend/scripts/`、`backend/tests/`
- `frontend/src/`
- `scripts/`、`.env.example`
- `README.md`、`docs/`、`DEVELOPMENT_PROGRESS.md`

## 禁止修改范围

- 真实 `.env`、业务数据库、上传照片和 `.runtime/`
- 客户填写 Token 的生成、哈希、关闭、过期和单次提交语义
- 订单、客户、任务、收款和地图业务规则
- Git 历史、远程仓库、部署或外部服务

## 已确定实现要求

- 删除 `/api/auth/login`、`/api/auth/session`、`/api/auth/logout`。
- `/login` 仅作为旧书签兼容入口重定向到 `/admin`。
- 管理和移动 API 继续对非安全方法检查浏览器 Origin，但不检查身份。
- 不修改历史迁移 `0005_security_permissions`；新增迁移删除 `access_sessions`。
- `credentials.py` 只保留客户填写 Token 所需的 SHA-256 摘要。
- 不读取或清理真实 `.env`；遗留的密码哈希配置将不再被代码读取。

## 验收标准

1. `/admin`、`/mobile` 首次打开即可使用，页面无访问码和退出按钮。
2. 管理和移动 API 无 Cookie 可用，`/api/auth/*` 返回 404。
3. 不可信 Origin 的后台写请求仍返回 403，错误 Host 仍被拒绝。
4. 客户填写 Token 的读取、保存、提交、关闭和过期测试继续通过。
5. 最新数据库结构不含 `access_sessions`，且 Alembic metadata 无漂移。
6. 后端测试、前端测试、lint、类型检查和生产构建通过。

## 测试命令

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm test --prefix frontend -- --run
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
git diff --check
```

## 返回格式

- 修改结果与本地访问边界
- 自动化测试和构建证据
- 遗留配置或使用注意事项
