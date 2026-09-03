# P30 订单业务编号

## 背景

当前界面把数据库主键 `order_id` 当作订单辨识号展示。主键承担内部关联和接口寻址职责，订单永久删除后可能出现号码复用，不满足“第一单为 1、第二单为 2；第二单取消或删除后 2 永久作废，下一单仍为 3”的业务要求。

## 目标

- 为每个订单分配从 1 开始、全局唯一、严格递增的 `order_number`。
- 已成功创建的订单即使取消或永久删除，其编号也永久保留且不再发放。
- 订单管理、月历、当天上门列表、路线图、任务执行、工作台提醒和收款相关视图统一显示业务编号。
- 继续使用 `order_id` 作为内部 API 路径、外键和前端操作标识，避免破坏现有接口寻址。

## 允许修改范围

- `backend/app/models`、`backend/app/schemas`、`backend/app/api`、`backend/app/services` 中订单编号生成与只读输出链路。
- 新增一份 Alembic 迁移并更新迁移测试。
- `frontend/src/features/orders`、`plans`、`payments`、`tasks`、`dashboard`、`mobile`、`intake` 的类型、显示与测试。
- 与本功能直接相关的后端和前端测试、本文档。

## 禁止修改范围

- 不修改真实 `.env`、`data/catcare.db`、上传文件、客户资料或远端 Relay/NAS 数据。
- 不改变订单内部主键、现有 API 路径、收款关联、路线排序、日历筛选、订单状态机或删除规则。
- 不重启或部署当前 Alter 运行实例；源代码合并和本地部署需在 PR 及用户确认后另行进行。
- 不新增外部依赖，不自动合并 PR。

## 已确定实现要求

1. 新增永久保留的订单编号发放账本；发放记录不随订单删除，数据库层保证订单编号唯一且必须对应一条已发放记录。
2. 编号分配与订单插入位于同一数据库事务；所有 ORM 订单创建入口自动分配，避免 API、客户填写归档和 Seed 路径漏号。
3. 新迁移将现有订单按创建顺序稳定补号，并正确推进后续编号；空库升级后第一张订单编号为 1。
4. 后端响应同时保留内部 `order_id`/`id` 和业务 `order_number`，前端操作继续使用内部 ID，展示统一使用业务编号。
5. 前端对短暂的新旧运行版本不一致采用 `order_number ?? order_id` 的只读回退，不得因旧后端缺少新字段而崩溃；新后端契约必须始终返回编号。
6. 工作台中由后端生成的“订单 #...”提醒文本也必须使用业务编号。

## 验收标准

- 连续创建两单得到 1、2；取消第 2 单后再创建得到 3。
- 永久删除一个允许删除的订单后，再创建的新订单也不会复用已删除编号。
- 数据库拒绝重复编号或不存在于发放账本的编号，外键与唯一约束有效。
- 订单列表/详情、日历标记、当天上门、路线地图标记与提示、收款待收/流水/对话框、任务执行、工作台提醒均显示 `order_number`，不误显示内部 ID。
- 迁移在空库和含旧订单数据库上通过；`alembic check` 无漂移，SQLite `integrity_check=ok`、`foreign_key_check` 为空。
- 后端定向测试、后端全量测试、前端定向测试、前端全量测试、lint、typecheck、build、build:public 全部通过。

## 测试命令

- `python -m pytest backend/tests/test_migrations.py backend/tests/test_models.py backend/tests/test_order_api.py backend/tests/test_plan_api.py backend/tests/test_plan_route_api.py backend/tests/test_payment_api.py backend/tests/test_dashboard_api.py backend/tests/test_task_api.py backend/tests/test_mobile_api.py`
- `python -m pytest backend/tests`
- `npm test -- --run frontend/src/features/orders frontend/src/features/plans frontend/src/features/payments frontend/src/features/tasks frontend/src/features/dashboard`
- `npm test -- --run`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run build:public`

所有测试必须使用临时数据库，不得连接 `data/catcare.db`。

## 返回格式

- 数据库与编号分配方案。
- 后端和前端实际修改路径。
- 定向与全量验证结果。
- Git 初始状态、默认分支、任务分支、提交 SHA、远端 SHA、Push、PR、CI 和合并状态。
- 风险、回滚方式与部署待办。
