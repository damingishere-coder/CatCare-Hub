[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..\..')
$runtimeRoot = Join-Path $repoRoot '.runtime\catcare-synology\public-update'
$wheelDir = Join-Path $repoRoot '.runtime\catcare-synology\wheels'
$frontendDir = Join-Path $repoRoot 'frontend'
$composePath = Join-Path $repoRoot 'deploy\synology\compose.yaml'
$buildComposePath = Join-Path $repoRoot 'deploy\synology\compose.build.yaml'
$envPath = Join-Path $repoRoot 'deploy\synology\.env.example'
$archivePath = Join-Path $runtimeRoot 'catcare-public-images.tar'
$hashPath = Join-Path $runtimeRoot 'catcare-public-images.tar.sha256'
$images = @(
    'catcare/intake-relay:2026.08.27',
    'catcare/intake-gateway:2026.08.27'
)

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

$wheelCount = @(Get-ChildItem -LiteralPath $wheelDir -Filter '*.whl' -File -ErrorAction SilentlyContinue).Count
if ($wheelCount -eq 0) {
    throw "缺少 Relay 的离线 Linux 依赖；请先运行 Build-CatCareSynologyImages.ps1"
}

& npm --prefix $frontendDir run build:public
if ($LASTEXITCODE -ne 0) {
    throw "CatCare 公网页面构建失败，退出码：$LASTEXITCODE"
}

$publicCssFiles = @(Get-ChildItem -LiteralPath (Join-Path $frontendDir 'dist-public\assets') -Filter 'index-*.css')
if ($publicCssFiles.Count -ne 1) {
    throw "CatCare 公网页面样式产物数量异常：$($publicCssFiles.Count)"
}
$publicCss = [System.IO.File]::ReadAllText($publicCssFiles[0].FullName)
$requiredUtilities = @(
    '.rounded-\[2rem\]',
    '.bg-\[\#FFF9F1\]',
    '.max-w-xl',
    '.min-h-12',
    '.border-slate-300',
    '.fixed'
)
foreach ($utility in $requiredUtilities) {
    if (-not $publicCss.Contains($utility)) {
        throw "CatCare 公开构建缺少关键页面样式：$utility"
    }
}

$composeArgs = @(
    'compose',
    '--env-file', $envPath,
    '-f', $composePath,
    '-f', $buildComposePath,
    'build',
    '--pull=false',
    'relay',
    'gateway'
)
& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw "CatCare Relay/Gateway 镜像构建失败，退出码：$LASTEXITCODE"
}

foreach ($image in $images) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "缺少构建后的镜像：$image"
    }
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
& docker save --output $archivePath $images
if ($LASTEXITCODE -ne 0) {
    throw "CatCare 公网镜像导出失败，退出码：$LASTEXITCODE"
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(
    $hashPath,
    "$hash  catcare-public-images.tar`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Public images ready: $archivePath"
Write-Output "SHA256 file: $hashPath"
