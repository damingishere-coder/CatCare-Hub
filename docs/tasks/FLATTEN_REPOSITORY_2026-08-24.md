# 本地仓库目录扁平化

## 背景

Codex 保存的项目目录为 `C:\Users\10578\Documents\CatCare Hub`，真实 Git 仓库原先位于其下一级 `CatCare-Hub` 子目录，导致 Codex 不能在项目页识别 `main` 分支。

## 目标

- 将真实仓库的全部内容（包括 `.git`、本地配置、业务数据和运行目录）安全上移一层。
- 保持 Git 历史、远程仓库、业务数据库和上传内容完整。
- 更新 Alter 的 CatCare 后端、前端及 Python 路径并恢复服务。

## 允许修改范围

- 本地目录布局与本任务文档。
- CatCare 专属的 Alter 进程路径和项目内 `.runtime` 路径绑定。
- 迁移后不可复用的本地 Python 虚拟环境。

## 禁止修改范围

- 不删除或覆盖项目源代码、`.git`、`.env`、业务数据库、上传文件或备份。
- 不改写 Git 历史、不强制推送、不修改远程仓库地址。
- 不修改其他 Alter 项目或其他项目的运行状态和配置。
- 不输出、暂存或提交密钥、Token、密码、Cookie、数据库和运行时数据。

## 已确定实现要求

- 移动前必须确认外层只有待迁移的内层目录且不存在目标冲突。
- 先通过 Alter 正常停止 CatCare 的两个进程，并确认 5180/8000 不再监听。
- 迁移前备份业务数据库和 Alter 的 `projects.json`、`state.json`。
- 使用同一 PowerShell 进程逐项移动顶层内容；验证完成前保留旧虚拟环境备份。
- 更新 CatCare 专属的 Alter 路径，不触碰其他项目配置。
- 重新创建 `.venv`，因为 Windows 虚拟环境启动器包含旧绝对路径。

## 验收标准

- 新根目录直接包含 `.git`、`backend`、`frontend`，旧内层目录已为空并移除。
- Git 根目录为外层目录，分支为 `main`，远程仍为原 GitHub 仓库。
- 工作树仅包含本任务文档的预期修改。
- Alter 显示 CatCare 两个组件运行，5180/8000 正常监听。
- 后端健康检查和前端管理页面返回 HTTP 200。

## 测试命令

```powershell
git status --short --branch
git rev-parse --show-toplevel
.\.venv\Scripts\python.exe -m pytest backend\tests\test_health.py backend\tests\test_local_access.py
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

另需验证 `http://127.0.0.1:8000/api/health`、`http://127.0.0.1:5180/admin` 和 Alter 项目状态。

## 返回格式

- 报告旧路径、新路径、备份位置和虚拟环境处理结果。
- 报告 Git 分支、远程地址、提交与推送状态。
- 报告 Alter、端口、后端健康和前端页面验证结果。
