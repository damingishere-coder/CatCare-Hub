# CatCare-Hub 文档中心

这里保存 README 不适合展开的产品、开发和技术说明。README 展示当前产品能力；`history/` 与 `tasks/` 则保留演进过程和实现决策，不能替代代码与自动化测试所代表的当前事实。

## 产品与使用

- [产品指南](PRODUCT_GUIDE.md)：用户角色、业务对象、主要页面和端到端工作流。
- [项目状态](PROJECT_STATUS.md)：当前已实现范围、已知限制和路线图。
- [README 中文版](../README.md) / [English](../README.en.md)：项目主页与快速启动。

## 开发与架构

- [开发指南](DEVELOPMENT.md)：环境准备、启动、迁移、Seed、测试与构建。
- [架构与数据一致性](ARCHITECTURE_AND_DATA.md)：本地优先边界、数据模型、revision、幂等、备份和 Adapter。
- [CloudBase 公开填写骨架](../deploy/cloudbase/README.md)：仅面向 `/fill/:token` 的 relay 部署说明；不包含管理后台部署。

## 安全与隐私

- [安全与私有访问](SECURITY_AND_PRIVATE_ACCESS.md)：loopback、Trusted Host/Origin、日志脱敏和公网边界。
- [微信客户资料填写与审核](tasks/P22_WECHAT_CUSTOMER_INTAKE.md)：原始提交、审核草稿、幂等和 30 天中继清理策略。
- [路线可靠性](tasks/P21_ROUTE_PLANNING_RELIABILITY.md)：地址状态、闭环路线、顺序优化与降级。
- [收款作废审计](tasks/P19_OPERATIONAL_REFINEMENTS.md)：结算、改价和作废记录。

## 项目演进

- [历史档案](history/README.md)：旧状态快照、开发进度和早期执行文档。
- [`tasks/`](tasks/)：按开发阶段保留的验收记录与技术决策。
- [本次仓库主页装修任务](tasks/REPOSITORY_HOMEPAGE_REFRESH.md)：范围、禁区和验收标准。

如文档之间出现冲突，采用以下事实优先级：当前代码与迁移头 → 自动化测试 → 当前专题文档 → 历史档案。
