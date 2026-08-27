# 开发指南

## 环境要求

- Windows 10/11
- Python 3.12+
- Node.js 20.19+
- npm（随 Node.js 安装）

项目提供 Windows 批处理与 PowerShell 脚本。默认管理端地址是 `http://127.0.0.1:5180/admin`，API ready 地址是 `http://127.0.0.1:8000/api/ready`。

## 首次安装与启动

```powershell
setup.bat
start.bat
```

`setup.bat` 创建虚拟环境、安装后端依赖、执行迁移并安装前端依赖。`start.bat` 会检查端口归属和 API readiness；如果端口已被其他进程占用，它会停止并提示，而不会接管未知进程。

停止由脚本启动的本地实例：

```powershell
stop.bat
```

## 数据库与 Seed

```powershell
migrate.bat
seed.bat
```

Seed 是幂等的虚构数据，只用于开发与演示。不要在未知数据库上运行 Seed。自定义数据库时显式设置 `CATCARE_DATABASE_URL`，例如测试目录中的独立 SQLite 文件。

SQLite 自动升级会先备份再迁移。迁移故障时保留错误和备份，不要删除数据库后“重试”。

## 前端开发

```powershell
npm run dev --prefix frontend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix frontend -- --run
npm run build --prefix frontend
npm run build:public --prefix frontend
```

`build` 生成管理端，`build:public` 只生成客户填写公开端。公开构建不能加入管理路由或后台导航。

## 后端开发

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
.venv\Scripts\python.exe -m alembic -c backend/alembic.ini check
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

健康检查只表示 API 进程响应；ready 检查还会验证数据库和 schema：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/ready
```

## 环境变量

从 `.env.example` 复制自己的本地 `.env`，不要提交真实值。主要分组包括：

- 数据库与本地工作区：`CATCARE_DATABASE_URL`、Trusted Host/Origin。
- 地图：高德 Key、路线模式和默认行政区。
- AI：可选的订单建议 Provider；未配置时使用本地回退。
- 客户填写：relay URL、共享密钥和保留周期。

不要在 Issue、日志、截图或测试夹具中写入 API Key、Token、真实地址、手机号、门禁或钥匙信息。

## 测试与提交前检查

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
npm test --prefix frontend -- --run
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
npm run build:public --prefix frontend
.venv\Scripts\python.exe -m alembic -c backend/alembic.ini check
git diff --check
```

GitHub Actions 在 Windows runner 上执行同一组后端和前端检查。构建成功不等于外部地图、AI、CloudBase 或公网访问已经真实连通。

## 常见故障

- **端口占用**：先确认监听 PID 与命令行，不要直接结束未知进程；可改用隔离端口开发。
- **ready 失败**：读取返回的 database 与 schema 信息，再检查数据库路径和迁移状态。
- **地图降级**：检查地址状态与 Provider 配置；本地顺序仍可用不代表道路路线已联网。
- **PWA 仍显示旧页面**：关闭旧标签并清理该站点缓存；不要依赖强刷掩盖构建问题。
