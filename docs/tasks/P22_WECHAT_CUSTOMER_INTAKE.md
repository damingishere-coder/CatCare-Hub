# P22：微信客户资料填写、工作台审核与安全归档

## 背景

现有项目已有 `/fill/:token`、客户填写草稿、后台审核稿以及转换为客户/订单的基础链路，但工作台入口错误指向无 Token 的 `/fill`，公开表单字段与当前业务要求不一致，也缺少客户-only 归档、作废、完整审核编辑、云端中转和跨本机/云端幂等回执。

## 目标

- 客户通过微信内 HTTPS 网页填写最少资料，提交后原稿锁定。
- 工作台直接展示完整审核区，支持保存审核稿、仅归档客户、归档并生成已确认订单、作废。
- 本机 SQLite 作为正式归档库；CloudBase 仅作为公开填写和待审核中转。
- 公开填写、同步和归档具备版本控制、幂等、脱敏和失败可恢复能力。

## 允许修改范围

- Intake、Customer、Order、Dashboard 相关后端模型、Schema、服务、API 与 Alembic 迁移。
- 客户填写页、工作台审核区、独立 Intake 页面、公开构建入口及相关前端 API/类型。
- CloudBase 静态托管、CloudBase Run、PostgreSQL 的非敏感部署骨架和说明。
- 相关测试、本任务文件、必要的 `.gitignore` 调整。
- 验收前对本机 SQLite 做备份、迁移和完整性检查。

## 禁止修改范围

- 不读取、输出、修改或提交 `.env`、密钥、Token、Cookie、浏览器数据。
- 不公开管理后台，不改变本机免登录/仅本机访问边界。
- 不引入 HeyForm、Formbricks、公众号或小程序。
- 不自动合并老客户；每次归档始终创建新客户。
- 不覆盖、清理、暂存 `.codemap/`、`PROJECT_AUDIT.md`、`docs/tasks/P21_ROUTE_PLANNING_RELIABILITY.md` 或其他任务外文件。
- 子代理不得修改生产代码、提交、推送、部署或执行生产数据库迁移。
- 未获得当次明确授权前，不创建 CloudBase 资源、不启用计费、不真实部署。

## 已确定实现要求

1. 客户必填姓名以及手机号/微信二选一；地址、门禁方式、钥匙状态、猫咪和简化服务计划均可选。
2. 公开页不收门禁密码、进门说明、钥匙编号、照片或文件；隐私说明只展示、不强制勾选。
3. 提交后客户不能再改，原链接只显示当前状态且不回显资料。
4. 工作台在今日区域下方嵌入完整审核工作区，窗口可见时 30 秒刷新；独立 `/admin/intake` 仍保留。
5. 审核稿可编辑完整客户、猫咪、服务事项和单价；原稿永久只读。
6. “仅归档客户”创建正常启用的新客户，可创建有名称的猫咪；不设置客户 `archived_at`。
7. “归档并生成订单”补齐地址、猫咪、日期、次数、服务事项和单价后，创建已确认订单及每日任务。
8. 保存、两种归档和作废都使用 revision；归档使用唯一来源 UUID 和幂等键，重试不得重复建档。
9. 云端仅存 Token 哈希、草稿、原稿、审核稿、状态和审计；本机服务端凭据访问管理接口，浏览器不得获取凭据。
10. 终态敏感内容云端保留 30 天后清除，本机永久保留原稿、审核稿和决策回执。
11. 独立公开构建只包含填写页；CloudBase Run 使用 FastAPI，数据库使用 CloudBase PostgreSQL。
12. 现场代码迁移头为 `0011_route_geocode_provenance`；本任务以 `0012` 扩展填写/归档字段，以 `0013` 增加无敏感内容的审计事件，并兼容现场数据库仍落后于代码头的情况。

## 验收标准

- 无 Token 的工作台入口问题消失，可生成、复制、停用 14 天专属链接。
- 最少资料可提交；公开页不出现敏感门禁字段；提交后锁定并只显示状态。
- 工作台可完成四个动作，客户-only 与客户+订单均事务安全、幂等且不自动合并。
- 云端不可用时只影响 Intake 区并准确报错，不影响工作台其他数据。
- 公开构建不含 `/admin` 路由；本机管理接口仍受仅本机访问保护。
- Alembic、SQLite 完整性/外键、后端测试、前端测试/lint/typecheck/build、公开构建和浏览器流程均通过。
- CloudBase 真实资源创建和微信公网验收只在用户单独授权后执行。

## 测试命令

```powershell
$env:PYTHONUTF8='1'
Push-Location backend
..\.venv\Scripts\python.exe -m pytest tests
..\.venv\Scripts\python.exe -m alembic -c alembic.ini current
..\.venv\Scripts\python.exe -m alembic -c alembic.ini check
Pop-Location
npm test --prefix frontend -- --run
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
npm run build:public --prefix frontend
git diff --check
```

## 返回格式

- 客户填写字段、工作台审核、两种归档、作废、并发/幂等和云端中转的完成情况。
- 数据库备份、迁移、完整性、测试、构建和浏览器验收的准确证据。
- CloudBase 未部署或已部署状态、实际域名和阻塞原因，不得把本地测试写成公网成功。
- 实际改动文件、依赖变化、任务外文件、敏感信息和 Git 推送复核结果。
