# GitHub 同步：本机免登录、P15 与 P16

## 背景

本地 `main` 基于远程 `origin/main` 的 `c442dac`，工作树包含已完成但尚未提交的本机免登录、P15 流程与视觉升级、P16 订单快照和路线推荐改动。本次任务只负责在保留全部本地成果的前提下验证、提交并同步到现有 GitHub 仓库。

## 目标

- 确认 GitHub 登录、当前分支、上游和 `origin` 地址。
- 先获取并拉取远程最新代码，再提交本地成果。
- 如出现冲突，保留本地代码并逐项合并，不使用强制覆盖或历史重写。
- 完成必要验证后创建一个汇总提交并推送 `main`。

## 允许修改范围

- 本次同步前已经存在的本机免登录、P15、P16 代码、迁移、测试和文档改动。
- 本同步任务记录。

## 禁止修改范围

- 不读取、暂存或提交 `.env`、数据库、日志、缓存、构建产物、备份和其他运行时数据。
- 不恢复已经按需求删除的旧鉴权模块。
- 不执行 `reset --hard`、强制推送、重写历史、删除分支或删除远程仓库。
- 不修改生产数据库，不发布或部署应用。

## 已确定实现要求

- `origin` 必须保持为 `https://github.com/damingishere-coder/CatCare-Hub.git`。
- 使用 `git fetch` 和 `git pull --ff-only` 更新远程基线；远程存在分叉时停止快进并人工审查。
- 只按明确项目路径暂存，不使用 `git add .` 或 `git add -A`。
- 提交前检查忽略规则、暂存 diff、敏感信息、TODO/debug 和临时文件。

## 验收标准

- 后端测试、前端测试、lint、类型检查和生产构建通过。
- `git diff --check` 无错误。
- 提交后工作树干净，`main...origin/main` 的 ahead/behind 为 `0 0`。
- GitHub 上的 `main` 与本地 `HEAD` 指向同一提交。

## 测试命令

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests
npm test --prefix frontend -- --run
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
git diff --check
```

## 返回格式

- 报告当前分支、远程仓库地址、提交哈希和推送结果。
- 分别报告拉取、测试、提交、推送和最终同步状态。
- 如有冲突或阻塞，给出准确错误和仍受保护的本地改动状态。
