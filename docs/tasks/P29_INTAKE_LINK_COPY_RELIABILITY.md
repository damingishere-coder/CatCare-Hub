# P29：填写链接复制可靠性

## 背景与目标

后台创建填写链接时，原文只在创建响应中返回。列表接口按安全约束返回 `fill_path: null`，当前页面的定时刷新、可见性刷新或较早请求晚到会覆盖创建结果，导致“复制/打开”入口消失。目标是在不持久化 Token 原文的前提下，保证当前页面内可以可靠复制刚生成的链接。

## 允许修改范围

- `frontend/src/features/intake/AdminIntakePage.tsx`
- `frontend/src/features/intake/AdminIntakePage.test.tsx`
- 本任务文档

## 禁止修改范围

- 后端接口、数据库、迁移和 Token 哈希规则
- 真实 Relay、真实填写链接和客户数据
- `.env`、密钥、Token、Cookie、日志和浏览器数据

## 已确定实现要求

- 创建成功后自动复制完整链接，并显示明确成功反馈。
- 自动复制失败时保留“打开/复制”入口并提示手动复制。
- 仅在 React 页面生命周期内缓存创建响应；不得写入浏览器存储或后端。
- 后台刷新需要合并服务器状态与页面内原文；较早 GET 晚到不得删除新链接或恢复已关闭状态。
- 链接关闭、过期或已提交后清除页面内原文；页面刷新后不可恢复。

## 验收标准与测试

- 自动复制成功、剪贴板失败降级、旧 GET 晚到、30 秒刷新、关闭后清理均有前端测试。
- 运行 `npm test -- --run src/features/intake/AdminIntakePage.test.tsx`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:public`。
- 返回修改摘要、测试结果、Git 分支/提交/远端 SHA、PR 与 CI 状态；不得自动合并。
