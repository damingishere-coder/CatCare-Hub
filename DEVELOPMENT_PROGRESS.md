# CatCare-Hub 开发进度

> 更新日期：2026-08-22

## 当前状态

- 当前完成轮次：P1｜数据库与核心业务模型
- 下一轮：P2｜客户档案
- 正式开发依据：《猫咪喂养登记系统-开发执行文档.md》

## 轮次进度

| 轮次 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 项目检查与基础骨架 | 已完成 |
| P1 | 数据库与核心业务模型 | 已完成 |
| P2 | 客户档案 | 待开始 |
| P3 | 订单系统 | 待开始 |
| P4 | 订单计划与按天排程 | 待开始 |
| P5 | 地图与路线 | 待开始 |
| P6 | 任务执行 | 待开始 |
| P7 | 工作台 | 待开始 |
| P8 | 收款记录 | 待开始 |
| P9 | 手机执行端 | 待开始 |
| P10 | 客户填写入口 | 待开始 |
| P11 | 响应式与 PWA | 待开始 |
| P12 | 安全与联动预留 | 待开始 |
| P13 | 测试与数据验证 | 待开始 |
| P14 | UI Design 重构 | 待开始，必须等待功能稳定 |

## P0 完成内容

- 记录空仓库、Git、本机运行环境和技术选型基线。
- 将正式开发执行文档纳入仓库根目录。
- 建立 React + TypeScript + Vite 前端骨架。
- 建立 FastAPI 后端骨架和 `/api/health` 健康检查。
- 建立 `/admin`、`/mobile`、`/fill`、`/fill/:token` 路由边界。
- 建立工作台、订单计划、客户档案、收款记录、设置五项后台导航。
- 建立覆盖环境变量、数据库、上传、日志、缓存、依赖和运行状态的 `.gitignore`。
- 提供 Windows `setup.bat`、`start.bat`、`stop.bat` 一键入口。
- 增加前端路由测试与后端健康检查测试。

## P0 验证结果

- `npm ci --prefix frontend`：通过，0 个已知漏洞。
- `npm run lint --prefix frontend`：通过。
- `npm run typecheck --prefix frontend`：通过。
- `npm test --prefix frontend -- --run`：通过，8 项测试全部成功。
- `npm run build --prefix frontend`：通过。
- `.\.venv\Scripts\python.exe -m pytest backend\tests`：通过，1 项测试成功。
- Windows 启动冒烟：API、后台、手机端和客户填写入口均返回 HTTP 200。
- Windows 停止冒烟：本项目的 8000 与 5180 监听均正确释放。
- Git 安全检查：未发现真实业务数据、环境变量、数据库、上传照片、日志或运行时文件进入暂存区。

## P1 完成内容

- 使用 SQLAlchemy 2 建立数据库 Base、引擎、会话和 SQLite 外键启用机制。
- 使用 Alembic 建立首个可升级、可降级迁移，迁移与模型自动差异检查无漂移。
- 建立 `customers`、`cats`、`orders`、`order_cats`、`tasks`、`task_items`、`task_photos`、`payments`、`customer_form_tokens`、`customer_form_submissions` 十张业务表。
- 为金额、日期范围、每日次数、坐标、任务顺序、状态、类型、唯一值和外键建立数据库约束。
- 为客户预留经纬度和地理编码状态，为猫咪预留停用状态，为图片只保存路径。
- 建立不含真实资料或有效 Token 的幂等虚构开发 Seed。
- 提供 `migrate.bat`、`seed.bat`，并让 `setup.bat` 自动迁移本地数据库。
- 补充 SQLite WAL/SHM 侧文件忽略规则。

## P1 验证结果

- Python 编译检查：通过。
- 后端测试：10 项全部通过，覆盖连接配置、迁移往返、模型漂移、十表关系、数据库约束、外键和 Seed 幂等性。
- 默认本地数据库：成功升级到 `0001_initial_schema (head)`。
- 虚构 Seed：首次写入成功，重复执行正确跳过。
- `migrate.bat`、`seed.bat`：在当前带空格的 Windows 路径下通过。
- P0 前端回归：lint、类型检查、8 项测试和生产构建全部通过。
- Windows 启停回归：API 和后台可访问，PowerShell 7 与 Windows PowerShell 均可安全识别并停止本项目进程，停止后 8000 与 5180 无残留监听。

## P2 计划边界

下一轮实现 `/admin/customers` 的客户与猫咪档案 CRUD、搜索、门禁/钥匙和注意事项管理。P1 没有提前实现页面、业务 API、订单自动生成任务、地图、图片上传或客户填写流程。
