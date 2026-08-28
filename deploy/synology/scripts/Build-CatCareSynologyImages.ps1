[CmdletBinding()]
param(
    [ValidatePattern('^https://')]
    [string]$PythonIndexUrl = 'https://pypi.org/simple'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..\..')
$runtimeRoot = Join-Path $repoRoot '.runtime\catcare-synology'
$archivePath = Join-Path $runtimeRoot 'catcare-synology-images.tar'
$hashPath = Join-Path $runtimeRoot 'catcare-synology-images.tar.sha256'
$wheelHashPath = Join-Path $runtimeRoot 'catcare-synology-wheels.sha256'
$composePath = Join-Path $repoRoot 'deploy\synology\compose.yaml'
$buildComposePath = Join-Path $repoRoot 'deploy\synology\compose.build.yaml'
$envPath = Join-Path $repoRoot 'deploy\synology\.env.example'
$relayRequirementsPath = Join-Path $repoRoot 'deploy\synology\intake-relay\requirements.lock'
$wheelDir = Join-Path $runtimeRoot 'wheels'
$frontendDir = Join-Path $repoRoot 'frontend'
$images = @(
    'catcare/intake-postgres:2026.08.27',
    'catcare/intake-relay:2026.08.27',
    'catcare/intake-gateway:2026.08.27',
    'catcare/intake-backup:2026.08.27'
)

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $wheelDir | Out-Null

& npm --prefix $frontendDir run build:public
if ($LASTEXITCODE -ne 0) {
    throw "CatCare 公网页面构建失败，退出码：$LASTEXITCODE"
}

$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    throw "未找到项目 Python：$venvPython"
}

$pipArgs = @(
    '-m', 'pip', 'download',
    '--index-url', $PythonIndexUrl,
    '--disable-pip-version-check',
    '--only-binary=:all:',
    '--implementation', 'cp',
    '--python-version', '312',
    '--abi', 'cp312',
    '--platform', 'manylinux2014_x86_64',
    '--no-deps',
    '--destination-directory', $wheelDir,
    '--requirement', $relayRequirementsPath
)
& $venvPython @pipArgs
if ($LASTEXITCODE -ne 0) {
    throw "CatCare Linux 依赖下载失败，退出码：$LASTEXITCODE"
}

$wheelHashes = Get-ChildItem -LiteralPath $wheelDir -Filter '*.whl' -File |
    Sort-Object Name |
    ForEach-Object {
        $digest = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$digest  $($_.Name)"
    }
[System.IO.File]::WriteAllLines(
    $wheelHashPath,
    $wheelHashes,
    [System.Text.UTF8Encoding]::new($false)
)

$composeArgs = @(
    'compose',
    '--env-file', $envPath,
    '-f', $composePath,
    '-f', $buildComposePath,
    'build',
    '--pull=false'
)
& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw "CatCare 镜像构建失败，退出码：$LASTEXITCODE"
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
    throw "CatCare 镜像导出失败，退出码：$LASTEXITCODE"
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(
    $hashPath,
    "$hash  catcare-synology-images.tar`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Images ready: $archivePath"
Write-Output "SHA256 file: $hashPath"
Write-Output "Wheel SHA256 file: $wheelHashPath"
