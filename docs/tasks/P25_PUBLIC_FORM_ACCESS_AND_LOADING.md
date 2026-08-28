# P25 客户表单门禁拆分与微信首屏提速

## 背景

群晖公网客户填写页已经通过 Tailscale Funnel 提供服务，但公开表单仍使用单一门禁字段并显示猫咪饮食输入框；当前 Gateway 也没有压缩 JS/CSS，微信首次打开下载较慢。

## 目标

- 删除公开表单中的猫咪饮食输入框，但保留旧草稿中的隐藏饮食资料。
- 将公开门禁拆分为小区门禁和楼下门禁，继续使用内部 `access_method` 存储，不迁移数据库。
- 开启静态资源 gzip、增加无脚本加载骨架，并从公开构建移除 React Router。
- 保持旧 `/fill/<token>`、新 `/f/<token>`、提交锁定、幂等和 30 天清理机制兼容。

## 允许修改范围

- `frontend/src/PublicApp.tsx`
- `frontend/src/pages/FillPage.tsx` 及对应测试
- `frontend/src/routes/AppRoutes.tsx`（仅保留本地开发路由兼容）
- `frontend/src/features/intake/types.ts`
- `frontend/src/features/intake/constants.ts`
- `frontend/public-entry/index.html`
- `backend/app/schemas/intake.py`
- `backend/app/services/intake.py` 及对应测试
- `deploy/synology/gateway/nginx.conf`
- 本任务文件

## 禁止修改范围

- `.codemap/**`、`PROJECT_AUDIT.md`
- `README.md`、`README.en.md`、`LICENSE`
- `.github/**`、`docs/assets/**`、`docs/history/**`
- `docs/README.md`、`docs/PRODUCT_GUIDE.md`、`docs/ARCHITECTURE_AND_DATA.md`
- `docs/DEVELOPMENT.md`、`docs/PROJECT_STATUS.md`
- `docs/tasks/REPOSITORY_HOMEPAGE_REFRESH.md`
- `docs/SECURITY_AND_PRIVATE_ACCESS.md`
- `.env`、密码、Token、Cookie、证书私钥和 NAS 凭据

## 已确定实现要求

- 两个门禁字段允许 `无`、`密码`、`门卡`、`钥匙开门`、`指纹或人脸`、`联系物业或门卫`；空值表示待确认。
- 新门禁值存为 `小区门禁：…；楼下门禁：…`；只要任一新字段有选择，就替换旧单一门禁值，否则保留旧值。
- 无法解析的旧门禁值只作为兼容提示显示，不自动猜测分类。
- 公开猫咪 Schema 保留旧字段；新 UI 不显示饮食，新建猫咪请求不主动产生饮食字段，旧值需原样回传。
- 公开入口直接解析 `/f/<token>` 与 `/fill/<token>`；管理后台继续使用 React Router。
- Gateway 开启 gzip，不放宽 CSP，不内联脚本，静态资源继续使用 immutable 缓存。
- 公网更新只允许重建 Relay/Gateway，不重启 PostgreSQL 或 Backup；执行前必须再次获得确认。

## 验收标准

- 两个门禁选择框独立工作且都有“无”，钥匙状态仍独立。
- 公开页面不显示饮食框，旧饮食和旧门禁可无损往返。
- 联系方式二选一、提交确认、幂等和提交后锁定继续通过。
- 新旧链接均可打开，非法路径显示链接无效。
- 公开构建的 JS+CSS gzip 总量不超过 100 KB，并可验证响应 `Content-Encoding: gzip`。
- 390×844 与 430×932 无横向溢出，加载骨架和底部提交栏不遮挡内容。
- `/admin`、DSM、SSH、数据库和管理 API 不得因本次改动公开。

## 测试命令

```powershell
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build:public
Set-Location backend
..\.venv\Scripts\python.exe -m pytest tests/test_intake_api.py tests/test_p13_acceptance.py -q
```

## 返回格式

- 列出实际修改文件。
- 报告测试、构建、压缩体积和视口结果。
- 公网更新、Git 提交和推送分别报告是否执行；未确认时明确停在确认点。
