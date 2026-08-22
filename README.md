# CatCare-Hub

CatCare-Hub 是面向个人上门喂猫业务的本地 Web 管理中台，用于逐步替代 Excel 管理客户、猫咪、订单、每日任务、路线与收款。

当前已完成 **P12｜安全与权限隔离**：PC 管理后台、轻量手机执行端和客户填写入口已建立独立权限边界；本地访问码只保存 PBKDF2 哈希，登录使用可撤销的服务端会话，客户填写 Token 也只以哈希落库。

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

`setup.bat` 会安装依赖、初始化本地访问码，并自动把本地数据库迁移到最新版本。首次初始化时会分别显示 admin 和 mobile 访问码，原文只显示一次，请立即保存到密码管理器；本机 `.env` 只保存带随机 salt 的不可逆哈希。升级已有项目时，建议先复制备份 `data/catcare.db`，再运行 `setup.bat` 应用最新迁移。运行日志与进程信息保存在本地 `.runtime/`，两者都不会提交到 Git。

如需重置访问码，请在 PowerShell 中运行以下命令并按隐藏提示输入两次新值（不要把访问码写进命令行）：

```powershell
.\.venv\Scripts\python.exe backend\scripts\manage_access.py --reset admin
.\.venv\Scripts\python.exe backend\scripts\manage_access.py --reset mobile
```

权限矩阵：admin 可进入管理后台和移动执行端；mobile 只能进入移动执行端；客户填写 Token 只能读取和提交该 Token 对应的一份表单，不能访问任何后台、任务或财务 API。

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
npm run preview --prefix frontend

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

## 今日工作台

启动后打开：

```text
http://localhost:5180/admin
```

工作台默认按 Asia/Shanghai 当天显示：

- 今日订单：当天非取消任务对应的去重订单数。
- 待执行：当天待确认、已确认、待出发和进行中的未结束任务数。
- 待收款：未取消、非退款且订单应收大于已收的订单数。
- 本月收入：付款时间落在本月且状态为已完成的收款记录金额。

“今日安排”按订单计划保存的路线顺序逐任务展示，同一订单每天多次上门会显示多行；点击后进入单任务执行详情。“今日提醒”覆盖钥匙待取、喂药、待发送照片、待收款、今日最后一次服务和明日开始订单。尚未处理的照片发送提醒会跨日保留，直到人工标记。

照片发送提醒不会自动向客户发送任何内容。用户通过外部渠道发送后，可以在工作台人工“标记已发送”；系统只记录 UTC 时间并使用任务 revision 防止旧页面覆盖。钥匙待取提醒只识别客户档案中的规范状态“待取”。

工作台批量响应只包含客户姓名、小区、猫咪数量和任务/订单摘要，不返回电话、完整地址、门禁、钥匙编号、备注或照片路径。待收提醒会直达对应订单的 P8 收款表单；填写链接统一在客户档案的“客户填写”次级页面生成。

## 客户填写与后台审核

启动后在客户档案点击“客户填写”，或直接打开：

```text
http://localhost:5180/admin/intake
```

后台可设置 1-90 天有效期并生成随机专属链接、复制完整链接、在未提交时关闭或恢复链接。客户打开 `/fill/:token` 后可保存草稿，并填写联系人、联系方式、地址、门禁/钥匙、多只猫咪、服务日期、每日次数、服务事项和备注。

客户提交后只进入“待审核”，不会自动建立正式客户或订单。后台可先标记已审核，再显式确认转换；系统会在一个数据库事务中创建客户、多只猫咪、一张待确认订单及全部每日任务。转换失败会整体回滚，重复确认不会重复创建记录。

提交摘要不批量返回手机号、详细地址、门禁、钥匙或猫咪要求，只有在后台选中单条提交后才读取完整资料。Uvicorn 访问日志会将公开 API 路径中的 Token 脱敏为 `[redacted]`，公开表单的 422 错误也不会回显无效输入值。客户链接使用加密安全随机 Token、有效期和关闭状态，数据库只保存 Token 的 SHA-256 哈希；链接原文只在生成响应中显示一次，刷新后台后无法恢复，遗失时应关闭旧链接并重新生成。

## 收款记录

启动后打开：

```text
http://localhost:5180/admin/payments
```

顶部显示今日已完成收款、待收订单数、本月已完成收款和累计完成订单。待收订单区展示客户、服务日期、猫咪数量、应收、已收和待收；收款流水区展示订单项目、微信/支付宝/现金/其他方式、金额、状态和 Asia/Shanghai 时间。

登记收款允许同一订单多次部分付款，也可以一次恰好结清。每次提交都带订单收款 revision，并在同一数据库事务内新增一条 `completed` Payment、增加订单已收金额和更新 `unpaid/partial/paid` 状态；超额、旧 revision、取消、退款或已结清订单会被拒绝，不会产生半条流水。

P8 流水只追加，不提供编辑、删除、撤销或退款。现有模型没有退款时间、原因和关联流水，相关功能必须等未来建立完整审计语义后再实现。收款批量响应不返回电话、微信、地址、门禁、钥匙或任何备注；备注仅随登记写入本地数据库。

## 客户档案

启动后打开：

```text
http://localhost:5180/admin/customers
```

客户列表只读取姓名、联系方式、小区和猫咪数量等必要摘要。详细地址、门禁、入户信息、钥匙编号和客户备注只在选中单个客户后显示。猫咪停用采用可恢复的状态标记，不会物理删除档案或未来订单历史。

本地开发服务器会把 `/api` 代理到 `127.0.0.1:8000`。后台与移动端已强制校验 HttpOnly 会话和角色，敏感响应禁止缓存；仍不应将 `/admin`、`/mobile`、`/api/admin/*` 或 `/api/mobile/*` 直接开放到公网。

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

点击生成路线会向地图服务发送小区、文字地址、楼栋及路线坐标；不会发送客户姓名、房号、手机号、微信、门禁、钥匙、客户备注或照片。地图请求只能从已登录的管理后台发起，管理入口仍不得对公网开放。

## 任务执行

在按天计划右侧选中任务后，可通过“进入任务执行”打开：

```text
http://localhost:5180/admin/tasks/:id
```

已确认或待出发的任务可以开始执行。任务开始后可逐项完成 Checklist、记录本次服务备注和猫咪状态、上传现场照片，也可以在发生问题时填写原因并标记异常。所有必做事项完成后才能完成任务；照片事项必须通过实际上传图片完成。完成或异常后记录进入只读状态，避免覆盖历史。

每次写入都携带任务修订值；如果另一个页面已经修改过任务，旧页面会停止继续写入并要求刷新。任务首次开始会把订单推进为进行中；只有全部未取消任务都完成后，订单才会自动完成，异常任务不会被误算为完成。

上传照片保存在本机 `data/uploads/tasks/`，数据库只记录相对访问路径。系统仅接受内容真实匹配的 JPEG、PNG 和 WebP，单张不超过 10 MiB、25,000,000 像素，并通过任务/照片归属校验的受控接口读取。上传目录受 `.gitignore` 保护，不得将真实现场图片加入 Git。

任务详情会显示现场执行所需的客户联系、地址、门禁、钥匙和猫咪注意事项。页面和接口已受 admin/mobile 角色会话保护，但仍只适用于本机或按安全说明配置的可信私网；不要把 `5180`、`8000` 端口或后台 API 直接暴露到公网。

## 手机执行端

在运行 CatCare-Hub 的电脑上打开：

```text
http://localhost:5180/mobile
```

手机与电脑位于同一可信局域网时，也可以把 `localhost` 换成运行电脑的局域网 IP。`/mobile` 默认按 Asia/Shanghai 当天显示任务总数、待执行数、已完成数和 P4 已保存的路线顺序；同一订单当天多次上门会保留为多条任务，不会被合并。

手机首页只返回客户姓名、小区、猫咪数量、计划时间、状态与导航状态，不批量返回电话、完整地址、门禁、钥匙、猫咪细节或照片。进入 `/mobile/tasks/:id` 后，才会按单个现场任务读取地址、联系信息、入户资料、猫咪要求和照片。

有 P5 缓存坐标且地图 Provider 可用时，可打开不含 Web Key 的高德导航 URI；没有坐标或地图未配置时，页面会保留文字任务并明确提示降级，不会在线解析地址、重新排程或生成假坐标。

已确认或待出发任务可以在手机端开始。进行中任务可更新 Checklist、猫咪状态、本次备注并从相机或相册上传 JPEG、PNG、WebP；所有写入继续使用 P6 revision、状态机和照片校验。P9 不提供异常结单入口，也不复制客户、订单、收款和计划编辑后台。

生产构建已经支持安装到主屏幕。为避免 Service Worker 缓存干扰日常开发，它只在生产构建和安全上下文注册；本机可使用两个 PowerShell 窗口验证：

```powershell
# 窗口 1：启动 API
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

# 窗口 2：构建并启动生产预览
npm run build --prefix frontend
npm run preview --prefix frontend
```

然后打开 `http://localhost:5180/mobile`，按页面提示或浏览器菜单选择“安装应用 / 添加到主屏幕”。普通局域网 IP 的 HTTP 页面通常不属于浏览器安全上下文，手机安装需要后续 HTTPS；能在局域网打开网页不等于可以安装 PWA。

离线能力只保留无业务数据的应用壳：首次联网并显示“离线应用壳已就绪”后，断网仍能打开页面结构，但任务读取、导航数据、Checklist、文字保存、照片上传和客户填写全部需要网络。Service Worker 不缓存 API、`/fill/:token`、照片、上传或客户敏感资料，也不提供离线写队列。

`/mobile` 与 `/api/mobile/*` 已强制要求 admin 或 mobile 会话；mobile 会话访问后台 API 会得到 403。会话仍需联网验证，PWA 不缓存身份、任务或任何敏感业务数据。

## 路由边界

- `/admin`：已实现的 PC 今日工作台
- `/admin/plans`：已实现的按天排程三栏页面，并可切换到订单管理
- `/admin/orders`：兼容入口，重定向到 `/admin/plans?view=orders`
- `/admin/customers`：已实现的客户与猫咪档案
- `/admin/intake`：已实现的填写链接、提交审核与原子转换页面
- `/admin/tasks/:id`：已实现的单任务执行与只读归档页面
- `/admin/payments`：已实现的待收订单、收款登记与流水页面
- `/mobile`：已实现的轻量今日任务与路线入口
- `/mobile/tasks/:id`：已实现的手机单任务现场执行页
- `/fill/:token`：已实现的专属客户资料草稿与一次性提交入口

## 数据安全

禁止将真实客户资料、手机号、地址、门禁、钥匙、访问码、Cookie、客户填写 Token/Payload、数据库、上传照片、`.env`、日志或本地运行文件提交到 GitHub。仓库只保存代码、配置模板和开发文档。默认保持本机运行；如需可信私网访问或未来仅发布客户填写入口，请先按 [P12 安全与私网访问说明](./docs/SECURITY_AND_PRIVATE_ACCESS.md) 配置 Host、Origin、HTTPS 与路径白名单，绝不能把整个管理站点直接转发到公网。

正式开发依据见 [《猫咪喂养登记系统-开发执行文档.md》](./猫咪喂养登记系统-开发执行文档.md)。
