param(
  [string]$TunnelName = "yuanio",
  [int]$RelayPort = 3000,
  [string]$ConfigPath = "$env:USERPROFILE/.cloudflared/config.yml",
  [string]$ServiceConfigPath = "C:/Windows/System32/config/systemprofile/.cloudflared/config.yml",
  [switch]$SkipRestart,
  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Normalize-CloudflaredPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
  return ($Path -replace "\\", "/")
}

function Normalize-BinPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
  return ((Normalize-CloudflaredPath $Path) -replace "\s+", " ").Trim()
}

function Get-ConfigValue([string]$ConfigRaw, [string]$Key) {
  $pattern = "(?m)^\s*$([regex]::Escape($Key))\s*:\s*(.+?)\s*$"
  $match = [regex]::Match($ConfigRaw, $pattern)
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value.Trim().Trim("'").Trim('"')
}

function Resolve-CredentialsFile([string]$ConfigPath, [string]$ConfigRaw) {
  $cred = Get-ConfigValue $ConfigRaw "credentials-file"
  if (-not $cred) {
    throw "配置缺少 credentials-file: $ConfigPath"
  }
  if ([System.IO.Path]::IsPathRooted($cred)) {
    return $cred
  }
  $baseDir = Split-Path -Parent $ConfigPath
  return Join-Path $baseDir $cred
}

function Get-TunnelRefFromConfig([string]$ConfigRaw, [string]$Fallback) {
  $tunnel = Get-ConfigValue $ConfigRaw "tunnel"
  if ($tunnel -and $tunnel -match "^[0-9a-fA-F-]{36}$") {
    return $tunnel
  }
  $cred = Get-ConfigValue $ConfigRaw "credentials-file"
  if ($cred) {
    $basename = [System.IO.Path]::GetFileNameWithoutExtension($cred)
    if ($basename -match "^[0-9a-fA-F-]{36}$") {
      return $basename
    }
  }
  if ($tunnel) {
    return $tunnel
  }
  return $Fallback
}

function Get-CloudflaredExecutablePath() {
  $cmd = Get-Command "cloudflared" -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "未找到 cloudflared，请先安装并加入 PATH。"
  }
  $exePath = $cmd.Source
  if ([string]::IsNullOrWhiteSpace($exePath)) {
    $exePath = $cmd.Definition
  }
  if (-not (Test-Path $exePath)) {
    throw "无法定位 cloudflared 可执行文件: $exePath"
  }
  return $exePath
}

function New-CloudflaredBackup([string]$UserConfigPath, [string]$ServiceConfigPath) {
  $userConfigDir = Split-Path -Parent $UserConfigPath
  $serviceConfigDir = Split-Path -Parent $ServiceConfigPath
  $backupRoot = Join-Path $userConfigDir "backups"
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $backupRoot $stamp
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

  if (Test-Path $UserConfigPath) {
    Copy-Item -Path $UserConfigPath -Destination (Join-Path $backupDir "user-config.yml") -Force
  }
  Get-ChildItem -Path $userConfigDir -Filter "*.json" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $backupDir "user-$($_.Name)") -Force
  }
  $userCertPath = Join-Path $userConfigDir "cert.pem"
  if (Test-Path $userCertPath) {
    Copy-Item -Path $userCertPath -Destination (Join-Path $backupDir "user-cert.pem") -Force
  }

  if (Test-Path $serviceConfigDir) {
    $serviceBackupDir = Join-Path $backupDir "systemprofile"
    New-Item -ItemType Directory -Path $serviceBackupDir -Force | Out-Null
    if (Test-Path $ServiceConfigPath) {
      Copy-Item -Path $ServiceConfigPath -Destination (Join-Path $serviceBackupDir "config.yml") -Force
    }
    Get-ChildItem -Path $serviceConfigDir -Filter "*.json" -File -ErrorAction SilentlyContinue | ForEach-Object {
      Copy-Item -Path $_.FullName -Destination (Join-Path $serviceBackupDir $_.Name) -Force
    }
    $serviceCertPath = Join-Path $serviceConfigDir "cert.pem"
    if (Test-Path $serviceCertPath) {
      Copy-Item -Path $serviceCertPath -Destination (Join-Path $serviceBackupDir "cert.pem") -Force
    }
  }
  return $backupDir
}

function Save-ServiceSnapshot([string]$BackupDir) {
  $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
  if (-not $svc) { return }
  sc.exe qc cloudflared | Out-File -FilePath (Join-Path $BackupDir "service-qc.txt") -Encoding utf8
  sc.exe queryex cloudflared | Out-File -FilePath (Join-Path $BackupDir "service-queryex.txt") -Encoding utf8
}

function Validate-CloudflaredConfig([string]$ConfigPath, [string]$Label) {
  if (-not (Test-Path "$ConfigPath")) {
    throw "未找到配置文件: $ConfigPath"
  }
  Write-Host "[check] 校验 cloudflared ingress 配置 ($Label)..." -ForegroundColor Cyan
  & cloudflared tunnel --config "$ConfigPath" ingress validate | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "cloudflared ingress 配置校验失败: $Label"
  }
}

function Get-ServiceBinaryPath() {
  $lines = sc.exe qc cloudflared 2>$null
  foreach ($line in $lines) {
    if ($line -match "BINARY_PATH_NAME\s*:\s*(.+)$") {
      return $Matches[1].Trim()
    }
  }
  return ""
}

function Ensure-ServiceInstalled() {
  $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
  if (-not $svc) {
    Write-Host "[cloudflared] 安装 Windows 服务..." -ForegroundColor Cyan
    cloudflared service install | Out-Host
    $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if (-not $svc) {
      throw "cloudflared 服务安装失败。"
    }
  } else {
    Write-Host "[cloudflared] 服务已存在: $($svc.Status)" -ForegroundColor Yellow
  }
}

function Sync-ServiceConfig(
  [string]$UserConfigPath,
  [string]$ServiceConfigPath,
  [int]$RelayPort
) {
  $userRaw = Get-Content -Path "$UserConfigPath" -Raw
  $credSource = Resolve-CredentialsFile "$UserConfigPath" $userRaw
  if (-not (Test-Path "$credSource")) {
    throw "未找到 credentials-file: $credSource"
  }

  $serviceDir = Split-Path -Parent $ServiceConfigPath
  New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null

  $credFileName = Split-Path -Leaf "$credSource"
  $serviceCredPath = Join-Path $serviceDir $credFileName
  Copy-Item -Path "$credSource" -Destination "$serviceCredPath" -Force

  $userCertPath = Join-Path (Split-Path -Parent $UserConfigPath) "cert.pem"
  if (Test-Path "$userCertPath") {
    Copy-Item -Path "$userCertPath" -Destination (Join-Path $serviceDir "cert.pem") -Force
  }

  $serviceCredPathForConfig = Normalize-CloudflaredPath "$serviceCredPath"
  $updatedRaw = $userRaw -replace "(?m)^\s*credentials-file\s*:\s*.+$", "credentials-file: $serviceCredPathForConfig"

  $expectedService = "service: http://localhost:$RelayPort"
  if ($updatedRaw -notmatch [regex]::Escape($expectedService)) {
    Write-Warning "config.yml 未检测到 '$expectedService'，请确认 ingress 转发端口配置。"
  }

  Set-Content -Path "$ServiceConfigPath" -Value $updatedRaw -Encoding utf8

  return [pscustomobject]@{
    ServiceConfigPath = $ServiceConfigPath
    ServiceCredentialPath = $serviceCredPath
    ServiceConfigRaw = $updatedRaw
  }
}

function Ensure-ServiceBinPath(
  [string]$CloudflaredExe,
  [string]$ServiceConfigPath,
  [string]$TunnelRef
) {
  $serviceConfigPathNorm = Normalize-CloudflaredPath "$ServiceConfigPath"
  $desiredBinPath = "`"$CloudflaredExe`" tunnel --config `"$serviceConfigPathNorm`" run $TunnelRef"
  $currentBinPath = Get-ServiceBinaryPath

  if ((Normalize-BinPath $currentBinPath) -ne (Normalize-BinPath $desiredBinPath)) {
    Write-Host "[cloudflared] 更新服务 binPath..." -ForegroundColor Cyan
    sc.exe config cloudflared binPath= $desiredBinPath start= auto | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "更新 cloudflared 服务配置失败。"
    }
  } else {
    Write-Host "[cloudflared] 服务 binPath 已符合预期。" -ForegroundColor Green
  }
}

if ($env:OS -ne "Windows_NT") {
  throw "该脚本仅支持 Windows。"
}

if (-not (Test-IsAdmin)) {
  throw "请用管理员 PowerShell 执行该脚本。"
}

if (-not (Test-Path "$ConfigPath")) {
  throw "未找到配置文件: $ConfigPath"
}

$cloudflaredExe = Get-CloudflaredExecutablePath
$userConfigRaw = Get-Content -Path "$ConfigPath" -Raw
$expectedService = "service: http://localhost:$RelayPort"
$expectedTunnel = "tunnel: $TunnelName"
$tunnelRef = Get-TunnelRefFromConfig $userConfigRaw $TunnelName

if ($userConfigRaw -notmatch [regex]::Escape($expectedTunnel)) {
  Write-Warning "config.yml 未检测到 '$expectedTunnel'，将优先使用配置中的 tunnel 值: $tunnelRef"
}

if ($userConfigRaw -notmatch [regex]::Escape($expectedService)) {
  Write-Warning "config.yml 未检测到 '$expectedService'，请确认 ingress 转发端口配置。"
}

Validate-CloudflaredConfig "$ConfigPath" "user"

$backupDir = $null
if (-not $SkipBackup) {
  $backupDir = New-CloudflaredBackup "$ConfigPath" "$ServiceConfigPath"
  Save-ServiceSnapshot "$backupDir"
  Write-Host "[backup] 已备份当前配置到: $backupDir" -ForegroundColor Green
}

$sync = Sync-ServiceConfig "$ConfigPath" "$ServiceConfigPath" $RelayPort
Validate-CloudflaredConfig "$ServiceConfigPath" "systemprofile"
Ensure-ServiceInstalled
Ensure-ServiceBinPath "$cloudflaredExe" "$ServiceConfigPath" "$tunnelRef"

if (-not $SkipRestart) {
  $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
  if ($svc.Status -eq "Running") {
    Restart-Service -Name "cloudflared" -Force
  } else {
    Start-Service -Name "cloudflared"
  }
}

$svc = Get-Service -Name "cloudflared"
Write-Host "[ok] cloudflared 服务状态: $($svc.Status)" -ForegroundColor Green
Write-Host "[info] TunnelName: $TunnelName"
Write-Host "[info] TunnelRef: $tunnelRef"
Write-Host "[info] Config: $ConfigPath"
$serviceConfigNorm = Normalize-CloudflaredPath "$ServiceConfigPath"
Write-Host "[info] Service Config: $serviceConfigNorm"
$serviceCredentialNorm = Normalize-CloudflaredPath "$($sync.ServiceCredentialPath)"
Write-Host "[info] Service Credentials: $serviceCredentialNorm"
$binPath = Get-ServiceBinaryPath
if ($binPath) {
  Write-Host "[info] Service binPath: $binPath"
}
if ($backupDir) {
  Write-Host "[info] 备份目录: $backupDir"
}
