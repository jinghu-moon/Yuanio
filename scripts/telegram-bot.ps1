param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start",
  [ValidateSet("auto", "lan", "public", "cloudflare")]
  [string]$NetworkMode = "auto",
  [string]$ControlServerUrl = "http://localhost:3000",
  [string]$PublicServerUrl = "",
  [string]$Namespace = "default",
  [int]$WebhookPort = 8787,
  [string]$WebhookPath = "/telegram/webhook",
  [string]$WebhookSecret = "",
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path -replace "\\", "/"
$LogsRoot = Join-Path $RepoRoot "logs/telegram-bot"
$StatePath = Join-Path $LogsRoot "state.json"

function Write-Info([string]$Message) { Write-Host "[info] $Message" -ForegroundColor DarkGray }
function Write-Ok([string]$Message) { Write-Host "[ok] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[warn] $Message" -ForegroundColor Yellow }

function Get-BunExecutable {
  $bun = Get-Command "bun" -ErrorAction SilentlyContinue
  if ($bun -and $bun.Source) { return $bun.Source }
  $bunExe = Get-Command "bun.exe" -ErrorAction SilentlyContinue
  if ($bunExe -and $bunExe.Source) { return $bunExe.Source }
  throw "未找到 bun，请先安装并加入 PATH。"
}

function Get-CargoExecutable {
  $cargo = Get-Command "cargo" -ErrorAction SilentlyContinue
  if ($cargo -and $cargo.Source) { return $cargo.Source }
  $cargoExe = Get-Command "cargo.exe" -ErrorAction SilentlyContinue
  if ($cargoExe -and $cargoExe.Source) { return $cargoExe.Source }
  throw "未找到 cargo，请先安装并加入 PATH。"
}

function Get-ListenerPid([int]$Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    return [int]$conn.OwningProcess
  } catch {
    return $null
  }
}

function Wait-Port([int]$Port, [int]$TimeoutMs = 8000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Get-ListenerPid $Port) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Stop-IfRunning([Nullable[int]]$ProcessId, [string]$Label) {
  if (-not $ProcessId) { return $false }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $proc) { return $false }
  Stop-Process -Id $ProcessId -Force
  Write-Ok "已停止 $Label (PID=$ProcessId)"
  return $true
}

function Load-State {
  if (-not (Test-Path $StatePath)) { return $null }
  try {
    return Get-Content -Raw "$StatePath" | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Save-State([hashtable]$State) {
  New-Item -ItemType Directory -Path "$LogsRoot" -Force | Out-Null
  ($State | ConvertTo-Json -Depth 8) | Set-Content -Path "$StatePath" -Encoding UTF8
}

function Load-TelegramKeys {
  $path = Join-Path $HOME ".yuanio/keys.json"
  if (-not (Test-Path $path)) {
    throw "未找到 $path，请先完成配对并保存 Telegram key。"
  }
  $raw = Get-Content -Raw "$path"
  $data = $raw | ConvertFrom-Json
  if (-not $data.telegramBotToken -or -not $data.telegramChatId) {
    throw "$path 缺少 telegramBotToken 或 telegramChatId。"
  }
  return $data
}

function New-WebhookSecret([int]$Length = 48) {
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $Length; $i += 1) {
    $idx = Get-Random -Minimum 0 -Maximum $chars.Length
    [void]$sb.Append($chars[$idx])
  }
  return $sb.ToString()
}

function Normalize-WebhookPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return "/telegram/webhook" }
  if ($Path.StartsWith("/")) { return $Path }
  return "/$Path"
}

function Resolve-CloudflareHostname {
  $cfg = Join-Path $HOME ".cloudflared/config.yml"
  if (-not (Test-Path $cfg)) { return $null }
  try {
    $raw = Get-Content -Raw "$cfg"
    $m = [regex]::Match($raw, "(?m)^\s*(?:-\s*)?hostname:\s*(\S+)\s*$")
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
  } catch {
    return $null
  }
  return $null
}

function Resolve-PublicServerForMode([string]$Mode, [string]$InputUrl) {
  if ($Mode -eq "lan") { return $null }

  $candidate = $InputUrl.Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $candidate = (Get-Item "Env:YUANIO_PUBLIC_SERVER" -ErrorAction SilentlyContinue).Value
  }
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $hostname = Resolve-CloudflareHostname
    if (-not [string]::IsNullOrWhiteSpace($hostname)) {
      $candidate = "https://$hostname"
    }
  }

  if ([string]::IsNullOrWhiteSpace($candidate)) {
    if ($Mode -eq "public" -or $Mode -eq "cloudflare") {
      throw "当前模式要求公网地址，请传 -PublicServerUrl 或配置 ~/.cloudflared/config.yml 的 hostname。"
    }
    return $null
  }

  if (-not ($candidate -match "^https://")) {
    throw "PublicServerUrl 必须是 HTTPS 地址: $candidate"
  }
  return $candidate.TrimEnd("/")
}

function Delete-TelegramWebhookIfNeeded([string]$BotToken) {
  if ([string]::IsNullOrWhiteSpace($BotToken)) { return }
  try {
    $url = "https://api.telegram.org/bot$BotToken/deleteWebhook"
    $body = @{ drop_pending_updates = $true } | ConvertTo-Json -Compress
    $resp = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Body $body -TimeoutSec 10
    if ($resp.ok -eq $true) {
      Write-Info "LAN 模式：已删除 Telegram webhook（避免指向旧公网地址）"
    } else {
      Write-Warn "LAN 模式：删除 webhook 失败: $($resp.description)"
    }
  } catch {
    Write-Warn "LAN 模式：删除 webhook 异常: $($_.Exception.Message)"
  }
}

function Show-Status {
  $state = Load-State
  $relayPid = Get-ListenerPid 3000
  $webhookPid = Get-ListenerPid $WebhookPort

  Write-Info "repo: $RepoRoot"
  Write-Info "relay(3000): $(if ($relayPid) { "LISTEN PID=$relayPid" } else { "NOT LISTEN" })"
  Write-Info "webhook($WebhookPort): $(if ($webhookPid) { "LISTEN PID=$webhookPid" } else { "NOT LISTEN" })"

  if ($state) {
    Write-Info "state: $StatePath"
    Write-Info "mode: $($state.effectiveMode) (requested=$($state.networkMode))"
    Write-Info "logDir: $($state.logDir)"
    Write-Info "controlServer: $($state.controlServerUrl)"
    Write-Info "publicServer(for cli): $($state.publicServerUrl)"
    Write-Info "webhookPublicUrl: $($state.webhookPublicUrl)"
    Write-Info "webhookUrl: $($state.webhookUrl)"
    Write-Info "cliPid: $($state.cliPid)"
    Write-Info "relayPid(started): $($state.relayPid)"
  } else {
    Write-Warn "未找到启动状态文件: $StatePath"
  }
}

if ($Action -eq "status") {
  Show-Status
  exit 0
}

if ($Action -eq "stop") {
  $state = Load-State
  if (-not $state) {
    Write-Warn "未找到状态文件，尝试按端口提示状态。"
    Show-Status
    exit 0
  }

  $stoppedAny = $false
  $stoppedAny = (Stop-IfRunning $state.cliPid "telegram-cli") -or $stoppedAny
  $stoppedAny = (Stop-IfRunning $state.relayPid "relay") -or $stoppedAny

  if (Test-Path "$StatePath") {
    Remove-Item -Path "$StatePath" -Force
  }

  if ($stoppedAny) {
    Write-Ok "Telegram bot 环境已停止。"
  } else {
    Write-Warn "没有可停止的进程（可能已退出）。"
  }
  exit 0
}

# start
$keys = Load-TelegramKeys
$publicServer = Resolve-PublicServerForMode $NetworkMode $PublicServerUrl
$effectiveMode = if ($publicServer) { "public" } else { "lan" }
$ingressNetworkMode = if ($NetworkMode -eq "auto") {
  $effectiveMode
} elseif ($NetworkMode -eq "cloudflare") {
  "cloudflare"
} elseif ($NetworkMode -eq "public") {
  "public"
} else {
  "lan"
}
$publicServerForCli = if ($publicServer) { $publicServer } else { $ControlServerUrl }
$normalizedPath = Normalize-WebhookPath $WebhookPath
$webhookUrl = if ($publicServer) { "$publicServer$normalizedPath" } else { "" }
$secret = if ($WebhookSecret) { $WebhookSecret.Trim() } elseif ($env:YUANIO_TELEGRAM_WEBHOOK_SECRET) { $env:YUANIO_TELEGRAM_WEBHOOK_SECRET } else { New-WebhookSecret }

if ($effectiveMode -eq "lan") {
  Delete-TelegramWebhookIfNeeded ([string]$keys.telegramBotToken)
}

New-Item -ItemType Directory -Path "$LogsRoot" -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $LogsRoot "$stamp"
New-Item -ItemType Directory -Path "$logDir" -Force | Out-Null

$relayListener = Get-ListenerPid 3000
$webhookListener = Get-ListenerPid $WebhookPort

if ($Restart) {
  if ($relayListener) { Stop-Process -Id $relayListener -Force }
  if ($webhookListener) { Stop-Process -Id $webhookListener -Force }
  Start-Sleep -Milliseconds 300
  $relayListener = Get-ListenerPid 3000
  $webhookListener = Get-ListenerPid $WebhookPort
}

if ($webhookListener) {
  throw "端口 $WebhookPort 已被 PID=$webhookListener 占用。可使用 -Restart 强制重启。"
}

$bunExe = Get-BunExecutable
$cargoExe = Get-CargoExecutable
$relayPid = $null
if (-not $relayListener) {
  $relayOut = Join-Path $logDir "relay.out.log"
  $relayErr = Join-Path $logDir "relay.err.log"
  $prevPort = $env:PORT
  $env:PORT = "3000"
  try {
    $relayProc = Start-Process -FilePath "$cargoExe" -ArgumentList @("run", "--manifest-path", "crates/relay-server/Cargo.toml") -WorkingDirectory "$RepoRoot" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$relayOut" -RedirectStandardError "$relayErr"
  } finally {
    if ($null -eq $prevPort) {
      Remove-Item -Path "Env:PORT" -ErrorAction SilentlyContinue
    } else {
      $env:PORT = $prevPort
    }
  }
  $relayPid = $relayProc.Id
  if (-not (Wait-Port 3000 8000)) {
    throw "relay 启动失败，端口 3000 未监听。日志: $relayOut / $relayErr"
  }
  $relayListenerPid = Get-ListenerPid 3000
  if ($relayListenerPid) { $relayPid = $relayListenerPid }
  Write-Ok "relay 已启动 (PID=$relayPid)"
} else {
  Write-Info "复用已有 relay (PID=$relayListener)"
}

$startCmdPath = Join-Path $logDir "start-cli-telegram.cmd"
$cliOut = Join-Path $logDir "cli.out.log"
$cliErr = Join-Path $logDir "cli.err.log"
$cmdLines = @(
  "@echo off",
  "set YUANIO_TELEGRAM_WEBHOOK_ENABLED=1",
  "set YUANIO_TELEGRAM_WEBHOOK_PORT=$WebhookPort",
  "set YUANIO_TELEGRAM_WEBHOOK_PATH=$normalizedPath",
  "set YUANIO_TELEGRAM_WEBHOOK_SECRET=$secret",
  "set YUANIO_TELEGRAM_AUTO_DELETE_WEBHOOK=0",
  "set YUANIO_TELEGRAM_WEBHOOK_DROP_PENDING=1",
  "set YUANIO_TELEGRAM_PROMPT_RECEIPT=0",
  "set YUANIO_TELEGRAM_REACTION_ENABLED=0",
  "set YUANIO_INGRESS_NETWORK_MODE=$ingressNetworkMode",
  "set YUANIO_TELEGRAM_SKILLS_PAGE_SIZE=12",
  "set YUANIO_TELEGRAM_WEBHOOK_URL=$webhookUrl",
  "bun run packages/cli/src/index.ts --server $ControlServerUrl --public-server $publicServerForCli --namespace $Namespace"
)
Set-Content -Path "$startCmdPath" -Value ($cmdLines -join "`r`n") -Encoding ASCII

$cliProc = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$startCmdPath`"") -WorkingDirectory "$RepoRoot" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$cliOut" -RedirectStandardError "$cliErr"
if (-not (Wait-Port $WebhookPort 10000)) {
  throw "telegram webhook 启动失败，端口 $WebhookPort 未监听。日志: $cliOut / $cliErr"
}
$cliPid = Get-ListenerPid $WebhookPort
if (-not $cliPid) { $cliPid = $cliProc.Id }

$state = [ordered]@{
  startedAt = (Get-Date).ToString("s")
  networkMode = $NetworkMode
  effectiveMode = $effectiveMode
  ingressNetworkMode = $ingressNetworkMode
  repoRoot = $RepoRoot
  logDir = $logDir
  relayPid = $relayPid
  cliPid = $cliPid
  controlServerUrl = $ControlServerUrl
  publicServerUrl = $publicServerForCli
  webhookPublicUrl = $publicServer
  webhookPort = $WebhookPort
  webhookPath = $normalizedPath
  webhookUrl = $webhookUrl
  namespace = $Namespace
}
Save-State $state

Write-Ok "Telegram bot 环境已启动。"
Write-Info "mode: $effectiveMode (requested=$NetworkMode)"
if ($effectiveMode -eq "public") {
  Write-Info "webhook: $webhookUrl"
} else {
  Write-Warn "LAN 模式：未配置公网 webhook。Telegram 无法主动回调到本机，不能直接在 Telegram 下发命令。"
  Write-Info "如需 Telegram 交互，请改用: -NetworkMode cloudflare 或传 -PublicServerUrl https://..."
}
Write-Info "日志目录: $logDir"
Write-Info "CLI 日志: $cliOut"
Write-Info "Relay 日志: $(Join-Path $logDir "relay.out.log")"
Write-Info '停止命令: powershell -ExecutionPolicy Bypass -File "./scripts/telegram-bot.ps1" stop'
