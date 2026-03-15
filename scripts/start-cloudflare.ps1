param(
  [string]$ServerUrl = "https://seeyuer-yuanio.us.ci",
  [string]$ControlServerUrl = "http://localhost:3000",
  [int]$RelayPort = 3000,
  [switch]$ReuseRelay,
  [switch]$NoTranscript,
  [switch]$NoVersionCheck,
  [switch]$AutoStartTunnel,
  [switch]$RestartRelay,
  [switch]$RestartTunnel,
  [int]$TunnelRetries = 5,
  [switch]$AutoConfirm
)

$ErrorActionPreference = "Stop"

$SpectreAvailable = $false
try {
  Import-Module PwshSpectreConsole -ErrorAction Stop | Out-Null
  $SpectreAvailable = $true
} catch { }
if ($AutoConfirm) { $SpectreAvailable = $false }

$script:UiMode = $false
$script:UiBusy = $false
$script:UiMaxLines = 200
$script:UiLog = New-Object System.Collections.Generic.List[object]
$script:ActiveTab = 0

function Escape-Markup([string]$Text) {
  if ($SpectreAvailable) { return ($Text | Get-SpectreEscapedText) }
  return $Text
}

function Write-Info([string]$Message) {
  Append-UiLog $Message "info" $false
  if (-not $script:UiMode) {
    if ($SpectreAvailable) { Write-SpectreHost "[grey]$(Escape-Markup $Message)[/]" } else { Write-Host $Message }
  }
}

function Write-Ok([string]$Message) {
  Append-UiLog $Message "ok" $false
  if (-not $script:UiMode) {
    if ($SpectreAvailable) { Write-SpectreHost "[green]$(Escape-Markup $Message)[/]" } else { Write-Host $Message }
  }
}

function Write-Warn([string]$Message) {
  Append-UiLog $Message "warn" $false
  if (-not $script:UiMode) {
    if ($SpectreAvailable) { Write-SpectreHost "[yellow]$(Escape-Markup $Message)[/]" } else { Write-Host $Message }
  }
}

function Write-ErrorLine([string]$Message) {
  Append-UiLog $Message "error" $false
  if (-not $script:UiMode) {
    if ($SpectreAvailable) { Write-SpectreHost "[red]$(Escape-Markup $Message)[/]" } else { Write-Host $Message }
  }
}

function Write-Rule([string]$Title) {
  if (-not $script:UiMode) {
    if ($SpectreAvailable) { Write-SpectreRule -Title (Escape-Markup $Title) } else { Write-Host "=== $Title ===" }
  }
}

function Format-TabBar([string[]]$Tabs, [int]$ActiveIndex) {
  if (-not $Tabs -or $Tabs.Count -eq 0) { return "" }
  $items = @()
  for ($i = 0; $i -lt $Tabs.Count; $i++) {
    $label = Escape-Markup $Tabs[$i]
    if ($i -eq $ActiveIndex) {
      $items += "[bold black on yellow] $label [/]"
    } else {
      $items += "[grey] $label [/]"
    }
  }
  return ($items -join " ")
}

function Write-TabBar([string[]]$Tabs, [int]$ActiveIndex) {
  if ($SpectreAvailable) {
    $bar = Format-TabBar $Tabs $ActiveIndex
    if (-not [string]::IsNullOrWhiteSpace($bar)) { Write-SpectreHost $bar }
  } else {
    $bar = ($Tabs | ForEach-Object { $_ }) -join " | "
    if ($ActiveIndex -ge 0 -and $ActiveIndex -lt $Tabs.Count) {
      Write-Host ("[TAB] {0}" -f $Tabs[$ActiveIndex])
    }
    if ($bar) { Write-Host $bar }
  }
}

function Append-UiLog([string]$Message, [string]$Level = "info", [bool]$Markup = $false) {
  if ([string]::IsNullOrWhiteSpace($Message)) { return }
  $null = $script:UiLog.Add([pscustomobject]@{
    Text = $Message
    Level = $Level
    Markup = $Markup
  })
  while ($script:UiLog.Count -gt $script:UiMaxLines) {
    $script:UiLog.RemoveAt(0)
  }
  if (-not $script:UiBusy) {
    if ($script:UiMode) { Render-Ui }
  }
}

function Render-Ui {
  if (-not $script:UiMode) { return }
  Clear-Host
  if ($SpectreAvailable) {
    Write-SpectreRule -Title (Escape-Markup "Yuanio 启动器")
    $bar = Format-TabBar $script:Tabs $script:ActiveTab
    if ($bar) { Write-SpectreHost $bar }
    foreach ($entry in $script:UiLog) {
      if ($entry.Markup) {
        Write-SpectreHost $entry.Text
        continue
      }
      $color = switch ($entry.Level) {
        "ok" { "green" }
        "warn" { "yellow" }
        "error" { "red" }
        default { "white" }
      }
      Write-SpectreHost "[$color]$(Escape-Markup $entry.Text)[/]"
    }
  } else {
    Write-Host "=== Yuanio 启动器 ==="
    Write-TabBar $script:Tabs $script:ActiveTab
    foreach ($entry in $script:UiLog) {
      Write-Host $entry.Text
    }
  }
}

function New-LogCursor([string]$Path) {
  return [pscustomobject]@{
    Path = $Path
    Position = 0
  }
}

function Read-NewLines([object]$Cursor) {
  if (-not $Cursor -or -not (Test-Path $Cursor.Path)) { return @() }
  $lines = @()
  try {
    $fs = [System.IO.File]::Open($Cursor.Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $fs.Seek([int64]$Cursor.Position, [System.IO.SeekOrigin]::Begin) | Out-Null
      $sr = New-Object System.IO.StreamReader($fs)
      try {
        while (-not $sr.EndOfStream) {
          $lines += $sr.ReadLine()
        }
        $Cursor.Position = $fs.Position
      } finally {
        $sr.Dispose()
      }
    } finally {
      $fs.Dispose()
    }
  } catch { }
  return $lines
}

function Pump-CliLogs {
  if (-not $script:UiMode) { return }
  $state = $script:State
  if (-not $state -or -not $state.StartedCliPid) { return }

  $proc = Get-Process -Id $state.StartedCliPid -ErrorAction SilentlyContinue
  if (-not $proc -and -not $state.CliExited) {
    Append-UiLog "[cli] 进程已退出"
    $state.CliExited = $true
    $state.StartedCliPid = $null
    $script:State = $state
    return
  }

  if ($state.CliOutCursor) {
    foreach ($line in (Read-NewLines $state.CliOutCursor)) {
      if ($line) { Append-UiLog "[cli] $line" "info" $false }
    }
  }
  if ($state.CliErrCursor) {
    foreach ($line in (Read-NewLines $state.CliErrCursor)) {
      if ($line) { Append-UiLog "[cli-err] $line" "warn" $false }
    }
  }
  $script:State = $state
}

function Run-Precheck {
  $state = $script:State
  $script:ActiveTab = 0
  Render-Ui
  if ($script:UiMode) {
    Append-UiLog ("[white]Repo:[/] [yellow]{0}[/]" -f (Escape-Markup $state.RepoRoot)) "info" $true
    Append-UiLog ("[white]ControlServerUrl:[/] [yellow]{0}[/]" -f (Escape-Markup $state.ControlServerUrl)) "info" $true
    Append-UiLog ("[white]PublicServerUrl:[/] [yellow]{0}[/]" -f (Escape-Markup $state.ServerUrl)) "info" $true
    Append-UiLog ("[white]RelayPort:[/] [yellow]{0}[/]" -f (Escape-Markup $state.RelayPort)) "info" $true
  } else {
    Write-Info "Repo: $($state.RepoRoot)"
    Write-Info "ControlServerUrl: $($state.ControlServerUrl)"
    Write-Info "PublicServerUrl: $($state.ServerUrl)"
    Write-Info "RelayPort: $($state.RelayPort)"
  }

  $state.Cloud = Invoke-WithStatus "检查 cloudflared 隧道状态" { Get-CloudflaredInfo $state.RelayPort }
  $state.HealthUrl = "$($state.ServerUrl)/health"
  $state.LocalHealthUrl = "http://localhost:$($state.RelayPort)/health"
  $state.RelayPid = Get-ListenerPid $state.RelayPort

  $state.CloudBound = Get-CloudBound $state.Cloud $state.CloudCfg $state.RelayPort
  $state.CloudDetail = Get-CloudDetail $state.CloudBound $state.CloudCfg $state.RelayPort

  if ($script:UiMode) {
    $cloudStatusText = if (-not $state.Cloud.Installed) { "未安装" } elseif (-not $state.Cloud.Running) { "未运行" } else { "运行中" }
    $cloudStatusColor = if (-not $state.Cloud.Installed) { "red" } elseif (-not $state.Cloud.Running) { "yellow" } else { "green" }
    Append-UiLog ("[white]Cloudflared:[/] [{0}]{1}[/]" -f $cloudStatusColor, (Escape-Markup $cloudStatusText)) "info" $true
  }

  $urlHost = Get-UrlHost $state.ServerUrl
  if ($state.CloudCfg -and $state.CloudCfg.Hostname -and $urlHost -and $state.CloudCfg.Hostname -ne $urlHost) {
    Write-Warn "ServerUrl 与 cloudflared hostname 不一致: $urlHost ≠ $($state.CloudCfg.Hostname)"
  }

  $rows = @(
    [pscustomobject]@{ Item = "Cloudflared"; Status = if (-not $state.Cloud.Installed) { "[red]未安装[/]" } elseif (-not $state.Cloud.Running) { "[yellow]未运行[/]" } else { "[green]运行中[/]" }; Detail = Escape-Markup $state.CloudDetail },
    [pscustomobject]@{ Item = "Relay (local)"; Status = if ($state.RelayPid) { "[green]运行中[/]" } else { "[yellow]未运行[/]" }; Detail = Escape-Markup $state.LocalHealthUrl }
  )
  Write-StatusTable $rows "隧道预检"

  $state.Prechecked = $true
  $script:State = $state
}

function Run-Start {
  $state = $script:State
  if (-not $state.Prechecked) { Run-Precheck; $state = $script:State }

  $script:ActiveTab = 1
  Render-Ui

  # 端口占用检查 / 重启 relay
  $listenerPid = Get-ListenerPid $state.RelayPort
  if ($RestartRelay -and $listenerPid) {
    $stopped = Stop-ProcessWithConfirm $listenerPid "relay"
    if ($stopped) { $listenerPid = $null }
  }
  if ($listenerPid) {
    $procInfo = Get-ProcessInfo $listenerPid
    $cmd = if ($procInfo) { $procInfo.CommandLine } else { "" }
    if ($ReuseRelay -or (Is-RelayProcess $procInfo)) {
      Write-Ok "[relay] 已在运行 (PID=$listenerPid)"
    } else {
      $ok = Confirm-Dangerous "终止占用端口的进程" "PID=$listenerPid`n$cmd" "可能影响该进程正在提供的服务"
      if (-not $ok) { throw "已取消启动" }
      Stop-Process -Id $listenerPid
      Start-Sleep -Milliseconds 300
      $state.StartedRelayPid = Invoke-WithStatus "启动本机 relay" { Start-Relay $state.RepoRoot $state.RelayLogOut $state.RelayLogErr }
    }
  } else {
    $state.StartedRelayPid = Invoke-WithStatus "启动本机 relay" { Start-Relay $state.RepoRoot $state.RelayLogOut $state.RelayLogErr }
  }

  # 重启 cloudflared（如请求）
  if ($RestartTunnel -and $state.CloudCfg -and $state.CloudCfg.Tunnel) {
    $pids = Get-CloudflaredPids $state.CloudCfg.Tunnel
    foreach ($procId in $pids) {
      $null = Stop-ProcessWithConfirm $procId "cloudflared"
    }
    $state.Cloud = Get-CloudflaredInfo $state.RelayPort
  }

  Write-Info "Relay 日志: $($state.RelayLogOut) / $($state.RelayLogErr)"

  if (-not (Wait-ForHealth $state.LocalHealthUrl 5000)) {
    Write-Warn "本机 /health 未就绪: $($state.LocalHealthUrl)"
  }

  # 启动 cloudflared（如未运行）
  if (-not $state.Cloud.Running -and $state.CloudCfg -and $state.CloudCfg.Tunnel) {
    $autoStart = if ($AutoStartTunnel) { $true } else { Read-Confirm "未检测到 cloudflared 进程，是否自动启动隧道？($($state.CloudCfg.Tunnel))" $true }
    if ($autoStart) {
      $state.StartedCloudPid = Invoke-WithStatus "启动 cloudflared" { Start-Cloudflared $state.CloudCfg.Tunnel $state.CloudLogOut $state.CloudLogErr }
      $state.Cloud = Get-CloudflaredInfo $state.RelayPort
      $state.CloudBound = Get-CloudBound $state.Cloud $state.CloudCfg $state.RelayPort
      $state.CloudDetail = Get-CloudDetail $state.CloudBound $state.CloudCfg $state.RelayPort
    }
  }

  # 远端健康检查
  $state.HealthOk = Invoke-WithStatus "检测远端 /health" { Wait-ForHealth $state.HealthUrl 8000 }
  $rows = @(
    [pscustomobject]@{ Item = "Cloudflared"; Status = if (-not $state.Cloud.Installed) { "[red]未安装[/]" } elseif (-not $state.Cloud.Running) { "[yellow]未运行[/]" } else { "[green]运行中[/]" }; Detail = Escape-Markup $state.CloudDetail },
    [pscustomobject]@{ Item = "Remote /health"; Status = if ($state.HealthOk) { "[green]可用[/]" } else { "[yellow]不可达[/]" }; Detail = Escape-Markup $state.HealthUrl }
  )
  Write-StatusTable $rows "隧道状态更新"
  if ($state.Cloud.Running) {
    Write-Info "Cloudflared 日志: $($state.CloudLogOut) / $($state.CloudLogErr)"
  }

  if (-not $state.HealthOk) {
    if ($state.Cloud.Running -and (Test-Path "$($state.CloudLogErr)")) {
      Write-Warn "cloudflared 错误日志（最近 20 行）:"
      Get-Content -Path "$($state.CloudLogErr)" -Tail 20 | ForEach-Object { Write-Warn $_ }
    }
    $continue = Read-Confirm "远端 /health 不可达，仍然继续启动？" $false
    if (-not $continue) { throw "已取消启动" }
  }

  $state.Started = $true
  $script:State = $state
}

function Run-Pair {
  $state = $script:State
  if (-not $state.Prechecked) { Run-Precheck; $state = $script:State }

  $script:ActiveTab = 2
  Render-Ui
  Write-Info "启动 CLI 并开始配对"

  if (-not (Wait-ForHealth $state.LocalHealthUrl 3000)) {
    $continue = Read-Confirm "本机 /health 未就绪，仍然继续启动 CLI？" $false
    if (-not $continue) { return }
  }

  if (-not $NoTranscript) {
    try { Start-Transcript -Path "$($state.SessionLog)" | Out-Null } catch { }
    Write-Info "会话日志: $($state.SessionLog)"
  }
  try {
    Start-CLI $state.RepoRoot $state.ControlServerUrl $state.ServerUrl -Foreground
  } finally {
    if (-not $NoTranscript) {
      try { Stop-Transcript | Out-Null } catch { }
    }
  }
  Write-Ok "完成: 配对流程已结束。"
}

function Stop-StartedProcesses {
  $state = $script:State
  $script:ActiveTab = 3
  Render-Ui

  $stoppedAny = $false
  if ($state.StartedCliPid) {
    $stoppedAny = (Stop-ProcessWithConfirm $state.StartedCliPid "cli (started)") -or $stoppedAny
    $state.StartedCliPid = $null
    $state.CliExited = $true
  }
  if ($state.StartedRelayPid) {
    $stoppedAny = (Stop-ProcessWithConfirm $state.StartedRelayPid "relay (started)") -or $stoppedAny
    $state.StartedRelayPid = $null
  }
  if ($state.StartedCloudPid) {
    $stoppedAny = (Stop-ProcessWithConfirm $state.StartedCloudPid "cloudflared (started)") -or $stoppedAny
    $state.StartedCloudPid = $null
  }

  if (-not $stoppedAny) {
    Write-Info "[exit] 没有可退出的进程"
  }
  $script:State = $state
}

function Run-InteractiveTabs {
  $script:UiMode = $true
  $script:ActiveTab = 0
  Render-Ui
  $refreshTimer = $null
  try {
    $refreshTimer = New-Object System.Timers.Timer
    $refreshTimer.Interval = 800
    $refreshTimer.AutoReset = $true
    $refreshTimer.add_Elapsed({
      if ($script:UiMode -and -not $script:UiBusy) {
        Pump-CliLogs
        Render-Ui
      }
    })
    $refreshTimer.Start()
  } catch { }
    :MainLoop while ($true) {
      Pump-CliLogs
      Render-Ui
      $script:UiBusy = $true
      try {
        $choice = Read-SpectreSelection -Message "选择操作" -Choices $script:Tabs -EnableSearch
      } finally {
        $script:UiBusy = $false
      }
      switch ($choice) {
        "预检" { Run-Precheck }
        "启动" { Run-Start }
        "配对" { Run-Pair }
        "退出" {
          Stop-StartedProcesses
          break MainLoop
        }
      }
      Pump-CliLogs
    }
  if ($refreshTimer) {
    try { $refreshTimer.Stop() } catch { }
    try { $refreshTimer.Dispose() } catch { }
  }
  $script:UiMode = $false
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "缺少命令: $Name"
  }
}

function Is-BrokenClaudeShim([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  if ($Path -notmatch "node_modules[\\/]\\.bin[\\/]claude(\\.exe|\\.cmd|\\.bat|\\.ps1|\\.bunx)?$") { return $false }
  $binDir = Split-Path $Path -Parent
  $nodeModules = Split-Path $binDir -Parent
  $cliPath = Join-Path $nodeModules "@anthropic-ai/claude-code/cli.js"
  return -not (Test-Path $cliPath)
}

function Add-CommandCandidate([System.Collections.ArrayList]$List, [string]$Path, [string]$Source, [bool]$SkipBrokenClaudeShim) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  if ($List | Where-Object { $_.Path -eq $Path }) { return }
  $broken = $SkipBrokenClaudeShim -and (Is-BrokenClaudeShim $Path)
  $exists = Test-Path $Path
  $null = $List.Add([pscustomobject]@{
    Path = $Path
    Source = $Source
    Exists = $exists
    BrokenShim = $broken
  })
}

function Resolve-AgentCommand([string]$Name, [string]$EnvVar, [bool]$Required, [bool]$SkipBrokenClaudeShim) {
  $candidates = New-Object System.Collections.ArrayList
  $override = (Get-Item -Path "Env:$EnvVar" -ErrorAction SilentlyContinue).Value
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    Add-CommandCandidate $candidates $override "env:$EnvVar" $SkipBrokenClaudeShim
  }
  $cmds = Get-Command $Name -All -ErrorAction SilentlyContinue
  foreach ($cmd in $cmds) {
    $path = $cmd.Source
    if ([string]::IsNullOrWhiteSpace($path)) { $path = $cmd.Definition }
    Add-CommandCandidate $candidates $path "path" $SkipBrokenClaudeShim
  }
  $selected = $null
  foreach ($c in $candidates) {
    if (-not $c.Exists) { continue }
    if ($c.BrokenShim) { continue }
    $selected = $c.Path
    break
  }
  if ($Required -and -not $selected) { throw "缺少命令: $Name（未检测到可用 CLI）" }
  return [pscustomobject]@{
    Name = $Name
    EnvVar = $EnvVar
    Selected = $selected
    Candidates = $candidates
  }
}

function Write-CommandCandidates([object]$Resolved) {
  if (-not $Resolved) { return }
  Write-Info "[cli] $($Resolved.Name) 候选:"
  foreach ($c in $Resolved.Candidates) {
    $flags = @()
    if (-not $c.Exists) { $flags += "missing" }
    if ($c.BrokenShim) { $flags += "broken-shim" }
    if ($Resolved.Selected -and $Resolved.Selected -eq $c.Path) { $flags += "selected" }
    $flagText = if ($flags.Count -gt 0) { " (" + ($flags -join ", ") + ")" } else { "" }
    Write-Info (" - {0}{1}" -f $c.Path, $flagText)
  }
}

function Invoke-VersionCheck([string]$Name, [string]$Path) {
  if ($NoVersionCheck) { return }
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $cmd = $Path
  $args = @("--version")
  if ($Path.ToLower().EndsWith(".ps1")) {
    $cmd = "pwsh"
    $args = @("-NoProfile","-ExecutionPolicy","Bypass","-File",$Path,"--version")
  }
  try {
    $output = & $cmd @args 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "[cli] $Name 版本检测失败 (exit $LASTEXITCODE)"
      return
    }
    $first = ($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    if ($first) {
      Write-Ok "[cli] $Name version: $first"
    } else {
      Write-Ok "[cli] $Name version: (empty)"
    }
  } catch {
    Write-Warn "[cli] $Name 版本检测异常: $($_.Exception.Message)"
  }
}

function Get-ListenerPid([int]$Port) {
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $listener) { return $null }
    return $listener.OwningProcess
  } catch {
    return $null
  }
}

function Get-ProcessInfo([int]$ProcessId) {
  return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Is-RelayProcess($Proc) {
  if ($null -eq $Proc) { return $false }
  $cmd = $Proc.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
  return ($cmd -match "relay-server") -or ($cmd -match "packages/relay-server") -or ($cmd -match "run src/index.ts")
}

function Confirm-Dangerous([string]$Op, [string]$Scope, [string]$Risk) {
  if ($AutoConfirm) {
    Write-Host "危险操作检测！"
    Write-Host "操作类型: $Op"
    Write-Host "影响范围: $Scope"
    Write-Host "风险评估: $Risk"
    Write-Host "已启用 AutoConfirm，自动继续。"
    return $true
  }
  if ($SpectreAvailable) {
    Write-SpectreHost "[red]危险操作检测！[/]"
    Write-SpectreHost "操作类型: $(Escape-Markup $Op)"
    Write-SpectreHost "影响范围: $(Escape-Markup $Scope)"
    Write-SpectreHost "风险评估: $(Escape-Markup $Risk)"
    try {
      $answer = Read-SpectreText -Prompt "请确认是否继续？(是/确认/继续)"
    } catch {
      $answer = Read-Host "请确认是否继续？(是/确认/继续)"
    }
  } else {
    Write-Host "危险操作检测！"
    Write-Host "操作类型: $Op"
    Write-Host "影响范围: $Scope"
    Write-Host "风险评估: $Risk"
    $answer = Read-Host "请确认是否继续？(是/确认/继续)"
  }
  return ($answer -in @("是", "确认", "继续"))
}

function Invoke-WithStatus([string]$Title, [scriptblock]$Block) {
  if ($script:UiMode) {
    Append-UiLog "[run] $Title" "info" $false
    $script:UiBusy = $true
    try {
      $result = & $Block
      Append-UiLog "[ok] $Title" "ok" $false
      return $result
    } finally {
      $script:UiBusy = $false
      Render-Ui
    }
  }
  if ($SpectreAvailable) {
    return Invoke-SpectreCommandWithStatus -Title $Title -ScriptBlock $Block
  }
  return & $Block
}

function Test-Health([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
    return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Get-CloudflaredInfo([int]$Port) {
  $cmd = Get-Command "cloudflared" -ErrorAction SilentlyContinue
  $procs = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue
  $running = $procs.Count -gt 0
  $match = $false
  if ($running) {
    $match = $procs | Where-Object { $_.CommandLine -match "localhost:$Port" -or $_.CommandLine -match "127.0.0.1:$Port" } | Select-Object -First 1
  }
  return [pscustomobject]@{
    Installed = [bool]$cmd
    Running = $running
    BoundToPort = [bool]$match
    CommandLine = if ($procs) { ($procs | Select-Object -First 1).CommandLine } else { "" }
  }
}

function Get-CloudflaredPids([string]$TunnelId) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue
  if (-not $procs) { return @() }
  if ([string]::IsNullOrWhiteSpace($TunnelId)) { return $procs | Select-Object -ExpandProperty ProcessId }
  $escaped = [regex]::Escape($TunnelId)
  return $procs | Where-Object { $_.CommandLine -match $escaped } | Select-Object -ExpandProperty ProcessId
}

function Stop-ProcessWithConfirm([int]$ProcessId, [string]$Label) {
  if (-not $ProcessId) { return $false }
  $procInfo = Get-ProcessInfo $ProcessId
  $cmd = if ($procInfo) { $procInfo.CommandLine } else { "" }
  $ok = Confirm-Dangerous "终止进程 ($Label)" "PID=$ProcessId`n$cmd" "可能影响该进程正在提供的服务"
  if (-not $ok) { return $false }
  Stop-Process -Id $ProcessId
  return $true
}

function Get-CloudflaredConfig([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  $raw = Get-Content -Path $Path -Raw
  $tunnel = [regex]::Match($raw, '(?m)^\s*tunnel:\s*(\S+)\s*$').Groups[1].Value
  $hostname = [regex]::Match($raw, '(?m)^\s*-\s*hostname:\s*(\S+)\s*$').Groups[1].Value
  $service = [regex]::Match($raw, '(?m)^\s*service:\s*(\S+)\s*$').Groups[1].Value
  return [pscustomobject]@{
    Tunnel = $tunnel
    Hostname = $hostname
    Service = $service
    Path = $Path
  }
}

function Get-UrlHost([string]$Url) {
  try {
    return ([Uri]$Url).Host
  } catch {
    return ""
  }
}

function Get-CloudBound([object]$Cloud, [object]$CloudCfg, [int]$Port) {
  if ($Cloud -and $Cloud.BoundToPort) { return $true }
  if ($CloudCfg -and $CloudCfg.Service) {
    return ($CloudCfg.Service -match "localhost:$Port" -or $CloudCfg.Service -match "127.0.0.1:$Port")
  }
  return $false
}

function Get-CloudDetail([bool]$Bound, [object]$CloudCfg, [int]$Port) {
  $detail = if ($Bound) { "配置指向 localhost:$Port" } else { "未检测到端口绑定" }
  if ($CloudCfg -and $CloudCfg.Hostname) { $detail = "$detail; $($CloudCfg.Hostname)" }
  return $detail
}

function Read-Confirm([string]$Message, [bool]$Default = $true) {
  if ($AutoConfirm) { return $true }
  if ($SpectreAvailable) {
    return Read-SpectreConfirm -Message $Message -DefaultAnswer ($(if ($Default) { "y" } else { "n" }))
  }
  $defaultText = if ($Default) { "y" } else { "n" }
  $answer = Read-Host "$Message [y/n] ($defaultText)"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return ($answer.Trim().ToLower() -in @("y", "yes"))
}

function Write-StatusTable([object[]]$Rows, [string]$Title) {
  if ($script:UiMode) {
    Append-UiLog $Title "info" $false
    foreach ($row in $Rows) {
      $line = "{0}  {1}  {2}" -f $row.Item, $row.Status, $row.Detail
      Append-UiLog $line "info" $true
    }
    return
  }
  if ($SpectreAvailable) {
    $table = $Rows | Format-SpectreTable -AllowMarkup -Title $Title -Expand
    Out-SpectreHost $table
  } else {
    Write-Host $Title
    foreach ($row in $Rows) {
      Write-Host ("{0}  {1}  {2}" -f $row.Item, $row.Status, $row.Detail)
    }
  }
}

function Wait-ForPort([int]$Port, [int]$TimeoutMs = 5000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Get-ListenerPid $Port) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Wait-ForHealth([string]$Url, [int]$TimeoutMs = 8000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Health $Url) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-BunExecutable() {
  $bunCmd = Get-Command "bun" -ErrorAction SilentlyContinue
  if ($bunCmd -and $bunCmd.Source) { return $bunCmd.Source }
  $bunExeCmd = Get-Command "bun.exe" -ErrorAction SilentlyContinue
  if ($bunExeCmd) { return $bunExeCmd.Source }
  return "bun"
}

function Get-CargoExecutable() {
  $cargoCmd = Get-Command "cargo" -ErrorAction SilentlyContinue
  if ($cargoCmd -and $cargoCmd.Source) { return $cargoCmd.Source }
  $cargoExeCmd = Get-Command "cargo.exe" -ErrorAction SilentlyContinue
  if ($cargoExeCmd -and $cargoExeCmd.Source) { return $cargoExeCmd.Source }
  return "cargo"
}

function Start-Relay([string]$RepoRoot, [string]$LogOut, [string]$LogErr) {
  Write-Info "[relay] 启动本机中继服务器..."
  $cargoExe = Get-CargoExecutable
  $prevPort = $env:PORT
  $env:PORT = "$RelayPort"
  try {
    $proc = Start-Process $cargoExe -ArgumentList @("run", "--manifest-path", "crates/relay-server/Cargo.toml") -WorkingDirectory "$RepoRoot" -RedirectStandardOutput "$LogOut" -RedirectStandardError "$LogErr" -PassThru
  } finally {
    if ($null -eq $prevPort) {
      Remove-Item -Path "Env:PORT" -ErrorAction SilentlyContinue
    } else {
      $env:PORT = $prevPort
    }
  }
  if (-not (Wait-ForPort $RelayPort 5000)) {
    Write-Warn "[relay] 启动后未监听端口 $RelayPort，请检查日志: $LogOut / $LogErr"
    if (Test-Path "$LogErr") {
      Write-Warn "[relay] 最近错误日志:"
      Get-Content -Path "$LogErr" -Tail 20 | ForEach-Object { Write-Warn $_ }
    }
  } else {
    Write-Ok "[relay] 已监听端口 $RelayPort (PID=$($proc.Id))"
  }
  return $proc.Id
}

function Start-Cloudflared([string]$TunnelId, [string]$LogOut, [string]$LogErr) {
  Write-Info "[cloudflared] 启动隧道: $TunnelId"
  $args = Build-CloudflaredArgs $TunnelId $TunnelRetries
  $proc = Start-Process "cloudflared" -ArgumentList $args -RedirectStandardOutput "$LogOut" -RedirectStandardError "$LogErr" -PassThru
  Start-Sleep -Milliseconds 800
  Write-Ok "[cloudflared] PID=$($proc.Id)"
  return $proc.Id
}

function Build-CloudflaredArgs([string]$TunnelId, [int]$Retries) {
  if ($Retries -gt 0) {
    return @("tunnel","--retries","$Retries","run",$TunnelId)
  }
  return @("tunnel","run",$TunnelId)
}

function Start-CLI([string]$RepoRoot, [string]$ControlUrl, [string]$PublicUrl, [switch]$Foreground) {
  Write-Info "[cli] 控制地址: $ControlUrl"
  Write-Info "[cli] 公网地址: $PublicUrl"

  # 配对时必须前台运行，否则 QR 码会被重定向到日志文件
  if ($Foreground -or -not $script:UiMode) {
    $wasUiMode = $script:UiMode
    if ($wasUiMode) {
      $script:UiMode = $false
      Write-Host ""
      Write-Host "── 进入前台配对模式（QR 码将显示在下方）──"
      Write-Host ""
    }
    $bunExe = Get-BunExecutable
    $prevDir = Get-Location
    Set-Location "$RepoRoot"
    try {
      if ($bunExe.ToLower().EndsWith(".ps1")) {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $bunExe run packages/cli/src/index.ts --server $ControlUrl --public-server $PublicUrl --pair
      } else {
        & $bunExe run packages/cli/src/index.ts --server $ControlUrl --public-server $PublicUrl --pair
      }
    } finally {
      Set-Location $prevDir
      if ($wasUiMode) {
        $script:UiMode = $true
        Write-Host ""
        Write-Host "── 配对完成，返回菜单 ──"
        Write-Host ""
      }
    }
    return
  }

  # UI 模式下非配对场景：后台启动
  $state = $script:State
  if (-not $state.CliLogOut) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $state.CliLogOut = "$($state.LogsDir)/cli-$stamp.out.log"
    $state.CliLogErr = "$($state.LogsDir)/cli-$stamp.err.log"
  }
  $bunExe = Get-BunExecutable
  if ($bunExe.ToLower().EndsWith(".ps1")) {
    $proc = Start-Process "pwsh" -ArgumentList "-File",$bunExe,"run","packages/cli/src/index.ts","--server",$ControlUrl,"--public-server",$PublicUrl,"--pair" -WorkingDirectory "$RepoRoot" -RedirectStandardOutput "$($state.CliLogOut)" -RedirectStandardError "$($state.CliLogErr)" -PassThru
  } else {
    $proc = Start-Process $bunExe -ArgumentList "run","packages/cli/src/index.ts","--server",$ControlUrl,"--public-server",$PublicUrl,"--pair" -WorkingDirectory "$RepoRoot" -RedirectStandardOutput "$($state.CliLogOut)" -RedirectStandardError "$($state.CliLogErr)" -PassThru
  }
  $state.StartedCliPid = $proc.Id
  $state.CliExited = $false
  $state.CliOutCursor = New-LogCursor $state.CliLogOut
  $state.CliErrCursor = New-LogCursor $state.CliLogErr
  $script:State = $state
  Write-Ok "[cli] 已后台启动 (PID=$($proc.Id))"
  Write-Info "[cli] 日志: $($state.CliLogOut) / $($state.CliLogErr)"
}

if ($MyInvocation.InvocationName -ne '.') {
  $RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path -replace "\\","/"
  Set-Location "$RepoRoot"

  Require-Command "bun"
  Require-Command "cargo"
  $claudeResolved = Resolve-AgentCommand "claude" "YUANIO_CLAUDE_CMD" $true $true
  $codexResolved = Resolve-AgentCommand "codex" "YUANIO_CODEX_CMD" $false $false
  $geminiResolved = Resolve-AgentCommand "gemini" "YUANIO_GEMINI_CMD" $false $false

  Write-CommandCandidates $claudeResolved
  Write-CommandCandidates $codexResolved
  Write-CommandCandidates $geminiResolved

  if ($claudeResolved.Selected) {
    Set-Item -Path "Env:YUANIO_CLAUDE_CMD" -Value $claudeResolved.Selected
    Write-Info "[cli] 使用 claude: $($claudeResolved.Selected)"
  }
  if ($codexResolved.Selected) {
    Set-Item -Path "Env:YUANIO_CODEX_CMD" -Value $codexResolved.Selected
    Write-Info "[cli] 可用 codex: $($codexResolved.Selected)"
  } else {
    Write-Warn "[cli] 未检测到 codex CLI"
  }
  if ($geminiResolved.Selected) {
    Set-Item -Path "Env:YUANIO_GEMINI_CMD" -Value $geminiResolved.Selected
    Write-Info "[cli] 可用 gemini: $($geminiResolved.Selected)"
  } else {
    Write-Warn "[cli] 未检测到 gemini CLI"
  }

  Invoke-VersionCheck "claude" $claudeResolved.Selected
  Invoke-VersionCheck "codex" $codexResolved.Selected
  Invoke-VersionCheck "gemini" $geminiResolved.Selected

  # 读取 cloudflared 配置，必要时自动推断 ServerUrl
  $cloudCfg = Get-CloudflaredConfig "$env:USERPROFILE/.cloudflared/config.yml"
  $serverUrlProvided = $PSBoundParameters.ContainsKey("ServerUrl")
  $controlServerUrlProvided = $PSBoundParameters.ContainsKey("ControlServerUrl")
  if (-not $serverUrlProvided -and $cloudCfg -and $cloudCfg.Hostname) {
    $ServerUrl = "https://$($cloudCfg.Hostname)"
  }
  if (-not $controlServerUrlProvided) {
    $ControlServerUrl = "http://localhost:$RelayPort"
  }

  $script:Tabs = @("预检","启动","配对","退出")
  $LogsDir = "$RepoRoot/logs"
  New-Item -ItemType Directory -Path "$LogsDir" -Force | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $script:State = @{
    RepoRoot = $RepoRoot
    ControlServerUrl = $ControlServerUrl
    ServerUrl = $ServerUrl
    RelayPort = $RelayPort
    CloudCfg = $cloudCfg
    LogsDir = $LogsDir
    RelayLogOut = "$LogsDir/relay-$stamp.out.log"
    RelayLogErr = "$LogsDir/relay-$stamp.err.log"
    CloudLogOut = "$LogsDir/cloudflared-$stamp.out.log"
    CloudLogErr = "$LogsDir/cloudflared-$stamp.err.log"
    SessionLog = "$LogsDir/session-$stamp.log"
    Cloud = $null
    RelayPid = $null
    CloudBound = $false
    CloudDetail = ""
    HealthUrl = ""
    LocalHealthUrl = ""
    HealthOk = $false
    StartedRelayPid = $null
    StartedCloudPid = $null
    StartedCliPid = $null
    CliLogOut = $null
    CliLogErr = $null
    CliOutCursor = $null
    CliErrCursor = $null
    CliExited = $false
    Prechecked = $false
    Started = $false
  }

  if ($SpectreAvailable -and -not $AutoConfirm) {
    Run-InteractiveTabs
  } else {
    Run-Precheck
    Run-Start
    Run-Pair
  }
}
