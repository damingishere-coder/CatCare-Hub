# CatCare-Hub

CatCare-Hub 是面向个人上门喂猫业务的本地 Web 管理中台，用于逐步替代 Excel 管理客户、猫咪、订单、每日任务、路线与收款。

当前已完成 **P6｜任务执行**：项目已具备客户、多猫、订单、按天排程、地图路线与单次上门执行闭环，支持开始任务、Checklist、照片、现场记录、异常处理、完成归档和订单进度联动。

## 当前技术栈

- 前端：React、TypeScript、Vite、React Router、Tailwind CSS、Lucide Icons
- 后端：FastAPI、SQLAlchemy 2、Alembic、HTTPX、Pillow
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

`setup.bat` 会安装依赖并自动把本地数据库迁移到最新版本。P6 首次使用前，如果本机已经有业务数据，建议先复制备份 `data/catcare.db`，再运行 `setup.bat` 应用最新迁移。运行日志与进程信息保存在本地 `.runtime/`，两者都不会提交到 Git。

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

## 订单系统

启动后打开：

```text
http://localhost:5180/admin/plans
```

可以按客户、猫咪、起止日期、每日次数和服务项目创建订单。系统会按包含首尾日期的天数自动生成每日任务，并按“基础服务费 + 多猫加价 + 爬楼费 + 其他费用”计算订单总额。订单编辑仅允许在任务尚未开始且没有照片、完成项目或执行时间记录时重建任务，以免覆盖执行历史。

`/admin/plans` 默认进入“按天计划”，采用左侧日期与任务、中间地图路线、右侧任务/客户信息的三栏布局；页面右上角可切换到“订单管理”。`/admin/orders` 作为兼容入口，会直接进入同一页面的订单管理视图。

当日排程支持上移、下移、计划时间、保存与撤销。保存请求会携带日计划修订值，避免旧页面覆盖已经变化的任务；当天一旦产生开始时间、完成事项、照片或执行状态，排程即锁定以保护历史。P4 只维护待确认、已确认、待出发和已取消四种计划状态，现场执行状态留给 P6。

中栏初次加载只读取本地缓存，不会自动把地址发送给地图厂商。用户明确点击“生成路线”后，系统才会解析缺少坐标的地址并计算真实驾车路线；当前顺序、推荐顺序、总距离和预计行驶时间均来自地图 Provider。推荐可一键采用，并继续受完整日排程修订值与执行历史锁定保护。

## 地图配置

P5 首个实现使用高德开放平台，但计划业务只依赖 `MapProvider`、`GeocodeProvider`、`RouteProvider` 和 `NavigationProvider`，没有在业务层写死厂商 API。

不配置地图时系统保持人工排程可用，并明确显示“地图未配置”，不会生成假坐标、假路线或假里程。需要启用时：

1. 将根目录 `.env.example` 复制为本机 `.env`。
2. 将 `CATCARE_MAP_PROVIDER` 改为 `amap`。
3. 填写本机高德 Web 服务 Key、家庭起点经纬度和可选城市。
4. 如需高德街道底图，再填写独立的 JS API Key 与本机 Security Code。
5. 重新运行 `start.bat`。

配置项说明：

```text
CATCARE_AMAP_WEB_KEY             后端地理编码和驾车路线，仅保存在本机
CATCARE_HOME_LATITUDE            路线起点纬度（GCJ-02）
CATCARE_HOME_LONGITUDE           路线起点经度（GCJ-02）
CATCARE_MAP_CITY                 可选的地理编码城市范围
VITE_AMAP_JS_API_KEY             浏览器街道底图 Key
VITE_AMAP_JS_API_SECURITY_CODE   浏览器 JS API 本机安全密钥
```

Web 服务 Key 不会返回浏览器。没有配置 JS API Key 时，页面仍会用 Provider-neutral 坐标画布展示后端返回的真实 Marker 和路线折线。高德 Key 的创建与使用应遵循[高德开放平台官方文档](https://lbs.amap.com/api/webservice/create-project-and-key)。

点击生成路线会向地图服务发送小区、文字地址、楼栋及路线坐标；不会发送客户姓名、房号、手机号、微信、门禁、钥匙、客户备注或照片。当前后台尚未完成 P12 鉴权，仍不得对公网开放。

## 任务执行

在按天计划右侧选中任务后，可通过“进入任务执行”打开：

```text
http://localhost:5180/admin/tasks/:id
```

已确认或待出发的任务可以开始执行。任务开始后可逐项完成 Checklist、记录本次服务备注和猫咪状态、上传现场照片，也可以在发生问题时填写原因并标记异常。所有必做事项完成后才能完成任务；照片事项必须通过实际上传图片完成。完成或异常后记录进入只读状态，避免覆盖历史。

每次写入都携带任务修订值；如果另一个页面已经修改过任务，旧页面会停止继续写入并要求刷新。任务首次开始会把订单推进为进行中；只有全部未取消任务都完成后，订单才会自动完成，异常任务不会被误算为完成。

上传照片保存在本机 `data/uploads/tasks/`，数据库只记录相对访问路径。系统仅接受内容真实匹配的 JPEG、PNG 和 WebP，单张不超过 10 MiB、25,000,000 像素，并通过任务/照片归属校验的受控接口读取。上传目录受 `.gitignore` 保护，不得将真实现场图片加入 Git。

任务详情会显示现场执行所需的客户联系、地址、门禁、钥匙和猫咪注意事项。P12 完整鉴权尚未实现，因此这些页面和接口目前只适用于受信任的本机环境；不要把 `5180`、`8000` 端口或 `/admin`、`/api/admin/*` 暴露到公网。

## 路由边界

- `/admin`：PC 管理后台
- `/admin/plans`：已实现的按天排程三栏页面，并可切换到订单管理
- `/admin/orders`：兼容入口，重定向到 `/admin/plans?view=orders`
- `/admin/customers`：已实现的客户与猫咪档案
- `/admin/tasks/:id`：已实现的单任务执行与只读归档页面
- `/mobile`：后续轻量执行端
- `/fill/:token`：后续客户填写入口

## 数据安全

禁止将真实客户资料、手机号、地址、门禁、钥匙、数据库、上传照片、`.env`、日志或本地运行文件提交到 GitHub。仓库只保存代码、配置模板和开发文档。

正式开发依据见 [《猫咪喂养登记系统-开发执行文档.md》](./猫咪喂养登记系统-开发执行文档.md)。
