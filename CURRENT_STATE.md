# CatCare-Hub 当前状态

> 检查时间：2026-08-22
> 对应开发轮次：P10｜客户填写入口完成

## 仓库

- 正式仓库：`https://github.com/damingishere-coder/CatCare-Hub.git`
- 默认分支：`main`
- 本地历史：P0-P9 已有独立提交，P10 完成验收后提交
- 远端状态：`origin/main: gone`，当前本地提交尚未推送到远端空分支
- 正式开发依据：根目录《猫咪喂养登记系统-开发执行文档.md》

## 当前技术状态

| 检查项 | 结果 |
| --- | --- |
| 当前完成轮次 | P10｜客户填写入口 |
| 下一轮 | P11｜响应式与 PWA |
| 前端 | React、TypeScript、Vite、React Router、Tailwind CSS |
| 后端 | FastAPI、SQLAlchemy 2、Alembic、HTTPX、Pillow |
| 数据库 | 本地 SQLite，迁移 head 为 `0004_customer_intake_conversion` |
| PC 核心 | 工作台、客户/猫咪、订单、按天计划、地图路线、任务执行、收款 |
| 手机核心 | 今日任务、路线顺序、导航、现场详情、Checklist、文字、图片、完成 |
| 客户填写 | 专属 Token、草稿/提交、后台审核与原子转换已实现 |
| PWA | 未实现，属于 P11 |
| 正式鉴权 | 未实现，属于 P12 |

## 当前路由与 API 边界

- `/admin`：PC 今日工作台
- `/admin/plans`：按天计划、地图路线与订单管理
- `/admin/customers`：客户与猫咪档案
- `/admin/intake`：填写链接、客户提交审核与正式记录转换
- `/admin/tasks/:id`：PC 单任务执行与归档
- `/admin/payments`：待收、登记与流水
- `/mobile`：手机今日路线与任务摘要
- `/mobile/tasks/:id`：手机单任务现场执行
- `/fill/:token`：专属客户资料草稿与一次性提交
- `/api/admin/*`、`/api/mobile/*` 与 `/api/fill/*` 已分命名空间，但尚未完成 P12 身份与权限隔离

## P10 验证基线

- 后端：66 项测试通过，覆盖 Token、草稿、提交、日志脱敏、错误去回显、审核、转换、幂等与回滚；`compileall` 通过。
- 前端：18 个测试文件、57 项测试通过，lint、TypeScript 与生产构建通过。
- 数据库：新增 `0004_customer_intake_conversion`；临时空库迁移、往返与 Alembic 自动差异检查纳入验收。
- Windows 与浏览器：使用 `.runtime/` 虚构临时库完成启动、Vite 代理、公开草稿/提交、后台审核与原子转换；390×844 填写页无横向溢出。
- 依赖：P10 未新增前端或后端依赖。

## 当前风险与约束

- `/admin`、`/mobile` 及对应 API 尚无正式鉴权，只允许本机或可信局域网使用，禁止公网暴露。
- P10 Token 使用加密安全随机值、有效期和关闭状态，但原文仍保存在本地数据库；Token 哈希、防刷、正式身份鉴别和角色权限属于 P12。
- 客户提交后只进入待审核；只有后台人工确认才会在一个事务中创建客户、猫咪、待确认订单和每日任务。
- 手机批量列表已做数据最小化，但单任务详情会按现场需要返回电话、完整地址、门禁、钥匙与猫咪注意事项。
- P9 仅显示 P4 保存顺序与 P5 缓存导航，不在手机端解析地址、规划路线或编辑计划。
- P11 前没有离线、安装或 Service Worker；P12 前没有角色、设备或操作人审计。
- 真实客户资料、手机号、地址、门禁、钥匙、数据库、上传照片、`.env`、日志和运行文件不得提交 GitHub。
