# P26：客户多选日期、订单日历排班与地图锚点

## 背景

公网客户填写页的原生日期区间控件在微信/iPhone 中会越界，也无法表达隔天或每周数次等不连续日期。后台订单详情占据主区域，缺少按月查看订单和按地理路线拖拽排班的统一工作区；自动地理编码发生偏差时也没有手动修正入口。客户填写链接和已作废提交的列表还需要收敛展示。

## 目标

- 公网客户可用自绘日历多选不连续上门日期，也可暂不选择日期提交。
- 后台审核兼容旧日期区间，新订单仅按选中日期生成一次上门任务。
- 订单管理以月历和当天排班为主，订单详情改为次级面板。
- 当天任务支持拖拽排序并与路线地图编号联动。
- 管理员可在高德地图上点击或拖动锚点，修正客户及相同地址未执行任务的定位。
- 已作废提交可从当前列表移除并恢复；生成链接默认仅展示最新三条。

## 允许修改范围

- `frontend/src/components/`、`frontend/src/features/`、`frontend/src/pages/`、前端测试与依赖锁文件。
- `backend/app/api/`、`backend/app/schemas/`、`backend/app/services/`、相关模型读取逻辑与后端测试。
- 本任务文档和必要的部署/接口说明。

## 禁止修改范围

- 不新增 Alembic 迁移，不修改现有数据库表结构。
- 不修改公网访问白名单，不开放 `/admin` 或管理 API。
- 不修改 `.env`、密钥、Cookie、真实客户数据、运行数据库或 NAS 文件。
- 不重启 Alter 管理的服务，不执行 NAS 更新、发布或数据库迁移。
- 不暂存或修改 `.codemap/`、`PROJECT_AUDIT.md`。

## 已确定实现要求

- 新 intake 日程使用排序去重后的 `service_dates`，最多 366 天；旧区间数据只读兼容，日历发生编辑后才切换为新语义。
- 新日程每个日期一次；没有日期可以提交，但不能归档为订单。
- 月历标记使用订单号，同一订单同日多次显示 `#订单号 ×N`，取消订单不显示。
- 拖拽仅调整所选日期内的任务顺序，保存复用现有 schedule API 和 revision 校验。
- 手动锚点只接受 GCJ-02；只改坐标，不改地址文字。客户主档、相同地址未取消/未完成订单及无执行历史任务同步更新，历史任务保持不变。
- 手动来源使用现有 `geocode_status/geocode_fingerprint/geocode_level` 字段表达；地址改变后手动坐标失效。
- 公网 Relay/Gateway 的 `service_dates` 协议必须同步，但真实更新需另行确认。

## 验收标准

- 公网填写页不存在原生日期输入框，390×844 与 430×932 无横向越界。
- 非连续日期经审核归档后只生成对应日期任务，旧每天两次订单不丢失语义。
- 订单月历、详情面板、拖拽列表和路线编号联动正确；锁定日与 revision 冲突不会被覆盖。
- 点击/拖动地图锚点后，可信手动坐标按规则同步；自动恢复失败时保留原手动位置。
- 已作废提交移除/恢复不改变原始提交；链接列表默认三条并可展开。
- 前后端完整测试、lint、typecheck、普通构建和 public 构建通过。

## 测试命令

```powershell
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run build:public
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -q
```

## 返回格式

- 报告实际改动、测试命令和结果、浏览器验收结果、风险与未执行的部署动作。
- 报告 Git 初始状态、任务分支、提交/远端 SHA、Push、PR 与 CI 状态。
