# CatCare 群晖公网填写部署

本目录部署的只有客户填写页面和中转 API。正式 SQLite、本地管理后台、订单、财务、客户档案 API、DSM、SSH、SMB 和 PostgreSQL 均不进入 Tailscale Funnel。

## 已确认的目标结构

```text
互联网 HTTPS :443
  -> Tailscale Funnel（只转发 NAS 127.0.0.1:18080 的公开 Gateway）
  -> gateway（只允许填写页和 public fill API）
  -> relay
  -> PostgreSQL（仅内部 Docker 网络）

Windows 管理端 -> Tailnet HTTPS :8443
  -> Tailscale Serve（只转发 NAS 127.0.0.1:18081）
  -> relay（Bearer Secret 只在 TLS 内传输）
```

## 本地生成镜像和部署包

当前网络无法可靠访问 Docker Hub，因此先在已缓存官方基础镜像的本机完成构建并导出。NAS 只导入最终 CatCare 镜像，不连接第三方镜像源，也不接收项目源码。

```powershell
.\deploy\synology\scripts\Build-CatCareSynologyImages.ps1
```

生成：

- `.runtime/catcare-synology/catcare-synology-images.tar`
- `.runtime/catcare-synology/catcare-synology-images.tar.sha256`
- `.runtime/catcare-synology/catcare-synology-wheels.sha256`

构建脚本先在 Windows 上生成公开前端，再把锁定的 Linux Python wheels 放入忽略的临时目录并离线安装进镜像。默认只从 PyPI 下载；若当前网络无法连接 PyPI，可在明确选定镜像源后通过 `-PythonIndexUrl 'https://...'` 临时覆盖。NAS 端始终只导入最终 TAR，不接触 Python 或 npm 软件源。

真实 Secret 只生成到 Git 忽略的 `.runtime/catcare-synology/`，不会打印到终端或写入 Git。重复生成部署包会复用同一组 Secret，避免已有数据库失去访问凭据。

```powershell
.\deploy\synology\scripts\New-CatCareSynologyBundle.ps1 `
  -PublicHost '<NAS 的完整 ts.net 域名>' `
  -NasLanIp '192.168.1.30'
```

生成文件：`.runtime/catcare-synology/catcare-synology.zip`。部署到 NAS 时先导入镜像 TAR，再把 ZIP 解压到 8T 存储空间的专用目录并创建 Container Manager 项目。

## 群晖目录边界

在 DSM 新建专用共享文件夹时，必须明确选择用户指定的 8T 存储空间。不要猜测 `/volume1`、`/volume2` 或 `/volume3`。解压后项目根目录应直接包含 `compose.yaml`、`.env`、`secrets/`、`data/` 和 `backups/`；NAS 不保存项目源码。

## 网络边界

- Funnel 目标：`http://127.0.0.1:18080`。
- Relay 宿主机端口只绑定 NAS 回环：`http://127.0.0.1:18081`，不得改回 NAS 局域网 IP 或 `0.0.0.0`。
- Windows 侧 `CATCARE_INTAKE_RELAY_URL` 必须使用 Tailscale Serve 提供的 `https://<NAS 的 tailnet DNS 名>:8443`，不能使用 `http://<NAS-LAN-IP>:18081`。
- PostgreSQL 无 `ports`，只能由内部 `data` 网络访问。
- 公网网关明确拒绝 `/api/admin/*`，其余非白名单路径统一 404。
- DS218+ 的群晖内核不支持 Docker `NanoCPUs` 硬配额，因此使用兼容的 `cpu_shares` 相对权重。该内核也会忽略 `pids_limit`；实际硬限制只有内存，进程数限制不能作为已生效的安全边界。

### Tailnet 内管理 HTTPS

以下命令属于设备侧网络变更，本仓库不会自动执行。首次配置或变更前，必须确认 Windows 和 NAS 位于同一 tailnet、MagicDNS/HTTPS 已启用，并在 tailnet ACL 中只允许指定 Windows 设备或用户访问 NAS 的 TCP 8443。然后由用户在 NAS SSH 终端执行：

```sh
tailscale serve --https=8443 --bg http://127.0.0.1:18081
tailscale serve status --json
```

Serve 8443 只在 tailnet 内可达并自动终止 TLS；公网 Funnel 继续使用 443。两者不得配置到同一端口。设备侧验收至少包括：

命令语法与端口隔离规则以 [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve) 和 [Tailscale Funnel 限制](https://tailscale.com/kb/1223/funnel) 为准。

```powershell
Test-NetConnection '<NAS-LAN-IP>' -Port 18081
Invoke-RestMethod 'https://<NAS-tailnet-DNS>:8443/api/ready'
```

第一条必须显示 LAN 直连失败，第二条必须通过系统信任链完成 HTTPS 校验并返回 `ready`。不得使用 `-SkipCertificateCheck`。Windows 防火墙三个 Profile 应继续启用且默认阻止入站，不要为 CatCare 的 8000、5180、18080 或 18081 新增入站放行规则。

## 公开 Gateway 的受限更新

公开页面改动不需要重建 PostgreSQL、Relay 或备份容器。先在 Windows 本机生成只包含 Gateway 的离线镜像包：

```powershell
.\deploy\synology\scripts\Build-CatCareGatewayUpdate.ps1
```

生成：

- `.runtime/catcare-synology/gateway-update/catcare-intake-gateway.tar`
- `.runtime/catcare-synology/gateway-update/catcare-intake-gateway.tar.sha256`

把两个文件上传到 NAS 固定目录 `/volume3/docker/CatCare/incoming/`。受限 SSH 只允许无参数命令 `catcare gateway-update`：它会校验 SHA-256、记录旧镜像、加载固定标签、只重建 Gateway，并在健康检查失败时自动回滚。它不会删除镜像包、旧镜像或数据。

首次启用该命令或修改受限授权时，必须先说明它会增加一个“只更新 CatCare Gateway”的免密码命令，并由用户亲自在 NAS SSH 终端中执行：

```sh
sudo sh /volume3/docker/CatCare/install-catcare-restricted-ssh.sh
```

安装脚本不会写入私钥。首次安装需要固定路径的 ED25519 公钥文件；已有 `catcare-nas-automation` 授权时只更新命令白名单。公网更新仍会造成填写页短暂停顿，执行前必须另行确认。

## Relay + Gateway 的受限公网更新

当改动同时涉及 Token 生成、中转 API 和公开页面时，只构建 Relay 与 Gateway：

```powershell
.\deploy\synology\scripts\Build-CatCarePublicUpdate.ps1
```

生成：

- `.runtime/catcare-synology/public-update/catcare-public-images.tar`
- `.runtime/catcare-synology/public-update/catcare-public-images.tar.sha256`

把两个文件上传到固定目录 `/volume3/docker/CatCare/incoming/`。受限 SSH 命令 `catcare public-update` 只加载固定 Relay/Gateway 标签、只重建这两个容器并检查 `/api/health` 与 `/api/ready`；失败时同时回滚两者。它不会重建或重启 PostgreSQL、备份容器，也不执行任意 Docker 或 Shell 命令。

新增该固定命令时仍需用户亲自在 NAS SSH 终端执行一次安装脚本并输入 `sudo` 密码；真正执行公网更新前也必须再次确认短暂停顿影响。

## 数据和备份

- `data/postgres/`：中转 PostgreSQL 数据。
- `backups/`：每天一个 custom-format `catcare-relay-*.dump`，保留 7 天。
- P22 完成/作废后的敏感 payload 仍按 30 天清理；恢复备份后必须先运行到期清理，再允许管理端同步。
- 验收时必须用 `pg_restore --list` 读取实际备份；只看到文件名不算通过。

## 公开前闸门

1. 四个容器均健康。
2. 公网填写、保存、提交和 tailnet HTTPS 审核链路通过；NAS LAN 的 18081 直连失败。
3. 网关对 `/admin`、`/api/admin/intake/tokens`、订单、财务和数据库端口拒绝。
4. `tailscale serve status --json` 证明管理入口只在 8443，且 tailnet ACL 已限制管理来源。
5. 用户再次确认“将 CatCare 指定入口公开到互联网”后，才执行 `tailscale funnel --bg http://127.0.0.1:18080`。

Funnel 当前仍是 Beta，存在带宽限制；家庭断网、断电、NAS 故障和第三方服务异常都会造成公网填写不可用，不构成正式生产 SLA。
