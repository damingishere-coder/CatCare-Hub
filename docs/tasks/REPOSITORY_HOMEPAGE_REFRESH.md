# GitHub Repository 主页产品化装修

## 背景

旧 README 主要面向开发过程，首屏混合内部轮次、数据库迁移和安全实现细节，缺少产品截图、业务工作流与清晰的快速启动。本任务在不改变业务行为的前提下，把仓库主页重构为成熟的开源项目入口。

## 目标

- 中文主 README 与英文镜像首先回答产品是什么、解决什么问题、长什么样、能做什么和如何运行。
- 使用真实本地 UI 与独立虚构数据制作 Dashboard Hero、路线、档案、填写/移动端和收款截图。
- 将迁移、revision、Token、幂等、PWA 缓存和完整命令下沉到专题文档。
- 补充 MIT License、Windows CI、Repository Description、Topics 和 Social Preview。
- 保留旧状态与开发执行文档，明确标记为历史档案。

## 允许修改范围

- `README.md`、`README.en.md`、`LICENSE`
- `.github/workflows/ci.yml`
- `docs/` 文档与 `docs/assets/` 产品展示资产
- GitHub Repository Description、Topics 与 Social Preview

## 禁止修改范围

- 前后端业务 API、数据模型、路由和核心行为
- 现有真实业务数据库、照片、备份与当前运行中的 `8000/5180` 实例
- `.env`、Key、Token、Cookie、真实手机号、地址、门禁、钥匙和其他隐私数据
- `.codemap/`、`PROJECT_AUDIT.md`、日志、缓存、构建产物和无关工作树修改
- 仓库可见性、权限、Issues、Wiki 与分支策略

## 已确定实现要求

- 截图环境使用独立端口、独立临时 SQLite 和纯虚构 Seed 数据。
- 路线截图使用确定性演示 Provider，不读取 AMap Key，不声明真实外部联通。
- README 只使用一个 Mermaid 架构图；截图采用一张大 Hero 与 2×2 Gallery。
- 项目状态写作“可用的本地优先 V1，持续开发中”，不得写作 production-ready。
- CloudBase 只描述为公开填写 relay 骨架，不声称已部署。
- CI Badge 必须连接真实 workflow，不能使用静态 passing 徽章。

## 验收标准

- 两份 README 的信息架构和相对链接对应，首屏不出现内部开发轮次和迁移实现。
- 五张产品截图和一张 1280×640 Social Preview 均来自虚构数据，不含隐私。
- README 图片、文档链接、Mermaid、Badges 在 GitHub 实际页面可渲染。
- 后端测试、前端测试、lint、typecheck、双构建、Alembic check 与 `git diff --check` 全部通过。
- GitHub 远端 SHA、Description、Topics、MIT License、CI 和自定义 Open Graph 图片可复核。
- 本次修改拆成 P22 功能提交和主页文档提交，最后进行一次普通推送，不强推。

## 测试命令

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
npm test --prefix frontend -- --run
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
npm run build:public --prefix frontend
.venv\Scripts\python.exe -m alembic -c backend/alembic.ini check
git diff --check
```

另需自动检查 README 相对链接、图片路径、尺寸与大小，并在本地和 GitHub 页面人工检查桌面与窄屏渲染。

## 返回格式

最终报告包括：两次提交哈希、分支与推送结果、README 新信息架构、参考项目与借鉴点、文件清单、测试证据、GitHub Actions 与远端页面核验结果。
