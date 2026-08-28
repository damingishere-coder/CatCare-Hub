[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..\..')
$runtimeRoot = Join-Path $repoRoot '.runtime\catcare-synology\gateway-update'
$frontendDir = Join-Path $repoRoot 'frontend'
$dockerfile = Join-Path $repoRoot 'deploy\synology\gateway\Dockerfile'
$archivePath = Join-Path $runtimeRoot 'catcare-intake-gateway.tar'
$hashPath = Join-Path $runtimeRoot 'catcare-intake-gateway.tar.sha256'
$image = 'catcare/intake-gateway:2026.08.27'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

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

& docker build --pull=false --file $dockerfile --tag $image $repoRoot
if ($LASTEXITCODE -ne 0) {
    throw "CatCare Gateway 镜像构建失败，退出码：$LASTEXITCODE"
}

& docker image inspect $image *> $null
if ($LASTEXITCODE -ne 0) {
    throw "缺少构建后的 Gateway 镜像：$image"
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
& docker save --output $archivePath $image
if ($LASTEXITCODE -ne 0) {
    throw "CatCare Gateway 镜像导出失败，退出码：$LASTEXITCODE"
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(
    $hashPath,
    "$hash  catcare-intake-gateway.tar`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Gateway image ready: $archivePath"
Write-Output "SHA256 file: $hashPath"
