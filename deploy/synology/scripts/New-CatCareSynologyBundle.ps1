[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$')]
    [string]$PublicHost,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$NasLanIp,

    [ValidateRange(1024, 65535)]
    [int]$FunnelTargetPort = 18080,

    [ValidateRange(1024, 65535)]
    [int]$RelayLanPort = 18081
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..\..')
$runtimeRoot = Join-Path $repoRoot '.runtime\catcare-synology'
$persistentSecrets = Join-Path $runtimeRoot 'secrets'
$bundleRoot = Join-Path $runtimeRoot 'bundle'
$zipPath = Join-Path $runtimeRoot 'catcare-synology.zip'

$repoRootFull = [System.IO.Path]::GetFullPath($repoRoot)
$runtimeRootFull = [System.IO.Path]::GetFullPath($runtimeRoot)
$bundleRootFull = [System.IO.Path]::GetFullPath($bundleRoot)
$expectedRuntimePrefix = $repoRootFull.TrimEnd('\') + '\.runtime\catcare-synology'
$expectedBundlePrefix = $runtimeRootFull.TrimEnd('\') + '\bundle'
if (-not $runtimeRootFull.Equals($expectedRuntimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '运行目录未解析到仓库内预期位置，已停止。'
}
if (-not $bundleRootFull.Equals($expectedBundlePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Bundle 目录未解析到运行目录内预期位置，已停止。'
}

function New-RandomSecret {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
    return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

function Ensure-SecretFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Test-Path -LiteralPath $Path) {
        if ((Get-Item -LiteralPath $Path).Length -gt 0) {
            return
        }
        throw "Secret 文件为空，已停止：$Path"
    }
    [System.IO.File]::WriteAllText(
        $Path,
        (New-RandomSecret),
        [System.Text.UTF8Encoding]::new($false)
    )
}

New-Item -ItemType Directory -Force -Path $runtimeRoot, $persistentSecrets | Out-Null
Ensure-SecretFile (Join-Path $persistentSecrets 'postgres_admin_password')
Ensure-SecretFile (Join-Path $persistentSecrets 'postgres_app_password')
Ensure-SecretFile (Join-Path $persistentSecrets 'relay_key')

if (Test-Path -LiteralPath $bundleRoot) {
    Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null

Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\synology\compose.yaml') -Destination (Join-Path $bundleRoot 'compose.yaml') -Force

Copy-Item -LiteralPath $persistentSecrets -Destination (Join-Path $bundleRoot 'secrets') -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $bundleRoot 'data\postgres'), (Join-Path $bundleRoot 'backups') | Out-Null

$envLines = @(
    "CATCARE_PUBLIC_HOST=$PublicHost",
    "CATCARE_NAS_LAN_IP=$NasLanIp",
    "CATCARE_FUNNEL_TARGET_PORT=$FunnelTargetPort",
    "CATCARE_RELAY_LAN_PORT=$RelayLanPort"
)
[System.IO.File]::WriteAllLines(
    (Join-Path $bundleRoot '.env'),
    $envLines,
    [System.Text.UTF8Encoding]::new($false)
)

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $bundleRoot,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

Write-Output "Bundle ready: $zipPath"
Write-Output 'Secrets were generated or reused without being printed.'
