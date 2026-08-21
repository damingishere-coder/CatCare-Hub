# CatCare-Hub

CatCare-Hub 是面向个人上门喂猫业务的本地 Web 管理中台，用于逐步替代 Excel 管理客户、猫咪、订单、每日任务、路线与收款。

当前处于 **P0｜项目检查与基础骨架**。本轮只建立可运行的前后端骨架、三端路由边界和后台导航，不包含真实业务数据与数据库功能。

## 当前技术栈

- 前端：React、TypeScript、Vite、React Router、Tailwind CSS、Lucide Icons
- 后端：FastAPI
- 数据库：将在 P1 使用 SQLite + SQLAlchemy，并保持未来迁移 PostgreSQL 的兼容性

## Windows 快速开始

需要先安装：

- Node.js 20.19 或更高版本（建议当前 LTS）
- Python 3.12 或兼容的 Python 3 版本

首次运行双击：

```text
setup.bat
```

安装完成后双击：

```text
start.bat
```

浏览器会打开：

```text
http://localhost:5180/admin
```

停止服务时双击：

```text
stop.bat
```

运行日志与进程信息保存在本地 `.runtime/`，该目录不会提交到 Git。

## 开发命令

```powershell
# 前端开发
npm run dev --prefix frontend

# 前端检查
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix frontend -- --run
npm run build --prefix frontend

# 后端开发（先运行 setup.bat）
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000

# 后端测试
.\.venv\Scripts\python.exe -m pytest backend\tests
```

后端健康检查地址：`http://localhost:8000/api/health`。

## 路由边界

- `/admin`：PC 管理后台
- `/mobile`：后续轻量执行端
- `/fill/:token`：后续客户填写入口

## 数据安全

禁止将真实客户资料、手机号、地址、门禁、钥匙、数据库、上传照片、`.env`、日志或本地运行文件提交到 GitHub。仓库只保存代码、配置模板和开发文档。

正式开发依据见 [《猫咪喂养登记系统-开发执行文档.md》](./猫咪喂养登记系统-开发执行文档.md)。
