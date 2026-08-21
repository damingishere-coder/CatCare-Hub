# CatCare-Hub

CatCare-Hub 是面向个人上门喂猫业务的本地 Web 管理中台，用于逐步替代 Excel 管理客户、猫咪、订单、每日任务、路线与收款。

当前已完成 **P2｜客户档案**：项目具备可迁移的本地数据库，以及可实际使用的客户与多猫档案管理闭环。后台可以搜索、新增、查看和编辑客户，维护门禁、钥匙与注意事项，并添加、编辑、停用或恢复猫咪。

## 当前技术栈

- 前端：React、TypeScript、Vite、React Router、Tailwind CSS、Lucide Icons
- 后端：FastAPI、SQLAlchemy 2、Alembic
- 数据库：本地 SQLite，结构保持未来迁移 PostgreSQL 的兼容性

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

`setup.bat` 会安装依赖并自动把本地数据库迁移到最新版本。运行日志与进程信息保存在本地 `.runtime/`，两者都不会提交到 Git。

## 数据库与虚构开发数据

默认数据库位置：

```text
data/catcare.db
```

该文件只保存在本机并受 `.gitignore` 保护。手动迁移数据库可双击：

```text
migrate.bat
```

需要开发演示数据时可双击：

```text
seed.bat
```

Seed 只包含明确标记为虚构的客户、猫咪、订单、任务和收款；不会生成手机号、门禁、钥匙、照片或可用的客户填写 Token，重复执行也不会重复插入。

如后续需要覆盖数据库连接，可在启动命令所在的环境中设置 `CATCARE_DATABASE_URL`。默认无需设置。

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

# 数据库迁移与版本检查
.\.venv\Scripts\python.exe -m alembic -c backend\alembic.ini upgrade head
.\.venv\Scripts\python.exe -m alembic -c backend\alembic.ini current

# 写入幂等的虚构开发 Seed
Push-Location backend
..\.venv\Scripts\python.exe -m app.db.seed
Pop-Location
```

后端健康检查地址：`http://localhost:8000/api/health`。

## 客户档案

启动后打开：

```text
http://localhost:5180/admin/customers
```

客户列表只读取姓名、联系方式、小区和猫咪数量等必要摘要。详细地址、门禁、入户信息、钥匙编号和客户备注只在选中单个客户后显示。猫咪停用采用可恢复的状态标记，不会物理删除档案或未来订单历史。

本地开发服务器会把 `/api` 代理到 `127.0.0.1:8000`。当前后台是本机自用版本，尚未实现 P12 的完整鉴权，不应将 `/admin` 或 `/api/admin/*` 直接开放到公网。

## 路由边界

- `/admin`：PC 管理后台
- `/admin/customers`：已实现的客户与猫咪档案
- `/mobile`：后续轻量执行端
- `/fill/:token`：后续客户填写入口

## 数据安全

禁止将真实客户资料、手机号、地址、门禁、钥匙、数据库、上传照片、`.env`、日志或本地运行文件提交到 GitHub。仓库只保存代码、配置模板和开发文档。

正式开发依据见 [《猫咪喂养登记系统-开发执行文档.md》](./猫咪喂养登记系统-开发执行文档.md)。
