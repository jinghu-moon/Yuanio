param(
    [ValidateSet("windows-terminal", "powershell", "cmd")]
    [string[]]$HostKinds = @("windows-terminal", "powershell", "cmd"),
    [int]$TimeoutSec = 12,
    [int]$HoldSec = 2,
    [int]$PollIntervalMs = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Title)
    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Resolve-BunExe {
    $bunCommand = Get-Command "bun" -ErrorAction Stop
    $source = $bunCommand.Source
    if ($source -like "*.ps1") {
        $candidate = Join-Path (Split-Path $source -Parent) "node_modules/bun/bin/bun.exe"
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }
    if ($source -like "*.exe") {
        return $source
    }
    throw "Unable to resolve bun.exe from: $source"
}

function New-SmokeLabel {
    param([Parameter(Mandatory = $true)][string]$HostKind)
    $stamp = Get-Date -Format "yyyyMMddHHmmssfff"
    $suffix = [Guid]::NewGuid().ToString("N").Substring(0, 6)
    return "launcher-smoke-$HostKind-$stamp-$suffix"
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)
    if ($Process.HasExited) {
        return
    }
    & "taskkill.exe" "/PID" "$($Process.Id)" "/T" "/F" *> $null
}

function Build-CmdCommand {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$BunExe,
        [Parameter(Mandatory = $true)][string]$Label,
        [bool]$ScrubHostMarkers = $false
    )

    $prefix = "cd /d `"$RepoRoot`" && "
    if ($ScrubHostMarkers) {
        $prefix += "set WT_SESSION= && set TERM_PROGRAM= && set ConEmuPID= && set MSYSTEM= && "
    }

    return "${prefix}set YUANIO_LAUNCHER_SMOKE_LABEL=$Label && `"$BunExe`" run packages/cli/src/index.ts launch"
}

function Build-PowerShellCommand {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$BunExe,
        [Parameter(Mandatory = $true)][string]$Label,
        [bool]$ScrubHostMarkers = $false
    )

    $repoLiteral = "'" + ($RepoRoot -replace "'", "''") + "'"
    $bunLiteral = "'" + ($BunExe -replace "'", "''") + "'"
    $labelLiteral = "'" + ($Label -replace "'", "''") + "'"
    $scrub = ""
    if ($ScrubHostMarkers) {
        $scrub = "Remove-Item Env:WT_SESSION, Env:TERM_PROGRAM, Env:ConEmuPID, Env:MSYSTEM -ErrorAction SilentlyContinue; "
    }

    return "& { Set-Location -LiteralPath $repoLiteral; ${scrub}`$env:YUANIO_LAUNCHER_SMOKE_LABEL = $labelLiteral; & $bunLiteral run 'packages/cli/src/index.ts' launch }"
}

function Start-SmokeHost {
    param(
        [Parameter(Mandatory = $true)][string]$HostKind,
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$BunExe,
        [Parameter(Mandatory = $true)][string]$Label,
        [string]$WtExe
    )

    $windowsPowerShell = Join-Path $env:WINDIR "System32/WindowsPowerShell/v1.0/powershell.exe"
    $cmdExe = Join-Path $env:WINDIR "System32/cmd.exe"

    switch ($HostKind) {
        "powershell" {
            $command = Build-PowerShellCommand -RepoRoot $RepoRoot -BunExe $BunExe -Label $Label -ScrubHostMarkers $true
            return Start-Process -FilePath $windowsPowerShell -WorkingDirectory $RepoRoot -ArgumentList @(
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-Command", $command
            ) -PassThru
        }
        "cmd" {
            $command = Build-CmdCommand -RepoRoot $RepoRoot -BunExe $BunExe -Label $Label -ScrubHostMarkers $true
            return Start-Process -FilePath $cmdExe -WorkingDirectory $RepoRoot -ArgumentList @(
                "/d",
                "/c",
                $command
            ) -PassThru
        }
        "windows-terminal" {
            if ([string]::IsNullOrWhiteSpace($WtExe)) {
                throw "wt.exe not found"
            }
            $command = Build-CmdCommand -RepoRoot $RepoRoot -BunExe $BunExe -Label $Label -ScrubHostMarkers $false
            return Start-Process -FilePath $WtExe -WorkingDirectory $RepoRoot -ArgumentList @(
                "-w", "new",
                "nt",
                "cmd.exe",
                "/d",
                "/c",
                $command
            ) -PassThru
        }
        default {
            throw "Unsupported host: $HostKind"
        }
    }
}

function Parse-LauncherStartLine {
    param(
        [Parameter(Mandatory = $true)][string]$Line,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [Parameter(Mandatory = $true)][string]$RequestedHost,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $pattern = 'launcher started host=(?<host>\S+) tier=(?<tier>\S+) utf8=(?<utf8>\S+) vt=(?<vt>\S+)(?: label=(?<label>\S+))?'
    $match = [regex]::Match($Line, $pattern)
    if (-not $match.Success) {
        return $null
    }

    return [pscustomobject]@{
        requestedHost = $RequestedHost
        observedHost = $match.Groups["host"].Value
        tier = $match.Groups["tier"].Value
        utf8Active = [System.Convert]::ToBoolean($match.Groups["utf8"].Value)
        vtModeActive = [System.Convert]::ToBoolean($match.Groups["vt"].Value)
        label = if ($match.Groups["label"].Success) { $match.Groups["label"].Value } else { $Label }
        logPath = $LogPath
        startLine = $Line.Trim()
    }
}

function Wait-LauncherSmokeRecord {
    param(
        [Parameter(Mandatory = $true)][string]$LogsDir,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$RequestedHost,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [Parameter(Mandatory = $true)][int]$TimeoutSec,
        [Parameter(Mandatory = $true)][int]$PollIntervalMs
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $escapedLabel = [regex]::Escape($Label)
    $linePattern = "launcher started .* label=$escapedLabel"

    while ((Get-Date) -lt $deadline) {
        $candidates = Get-ChildItem -Path $LogsDir -Filter "log-*.txt" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -ge $StartedAt.AddSeconds(-2) } |
            Sort-Object LastWriteTime -Descending

        foreach ($candidate in $candidates) {
            $hit = Select-String -Path $candidate.FullName -Pattern $linePattern -ErrorAction SilentlyContinue | Select-Object -Last 1
            if ($hit) {
                $parsed = Parse-LauncherStartLine -Line $hit.Line -LogPath $candidate.FullName -RequestedHost $RequestedHost -Label $Label
                if ($parsed) {
                    return $parsed
                }
            }
        }

        Start-Sleep -Milliseconds $PollIntervalMs
    }

    return $null
}

$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$logsDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}
$bunExe = Resolve-BunExe
$wtExe = (Get-Command "wt.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
$reportPath = Join-Path $logsDir ("launcher-host-smoke-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$results = New-Object System.Collections.Generic.List[object]

Write-Step "Launcher host smoke matrix"
Write-Host ("RepoRoot : {0}" -f $repoRoot)
Write-Host ("bun.exe  : {0}" -f $bunExe)
Write-Host ("Hosts    : {0}" -f ($HostKinds -join ", "))

foreach ($hostKind in $HostKinds) {
    if ($hostKind -eq "windows-terminal" -and [string]::IsNullOrWhiteSpace($wtExe)) {
        Write-WarnLine "Skipping windows-terminal: wt.exe not found"
        $results.Add([pscustomobject]@{
            requestedHost = $hostKind
            status = "skipped"
            reason = "wt.exe not found"
        }) | Out-Null
        continue
    }

    Write-Step "Smoke host: $hostKind"
    $label = New-SmokeLabel -HostKind $hostKind
    $startedAt = Get-Date
    $process = $null
    try {
        $process = Start-SmokeHost -HostKind $hostKind -RepoRoot $repoRoot -BunExe $bunExe -Label $label -WtExe $wtExe
        Write-Host ("PID      : {0}" -f $process.Id)
        Write-Host ("Label    : {0}" -f $label)

        $record = Wait-LauncherSmokeRecord -LogsDir $logsDir -Label $label -RequestedHost $hostKind -StartedAt $startedAt -TimeoutSec $TimeoutSec -PollIntervalMs $PollIntervalMs
        if ($record) {
            if ($HoldSec -gt 0) {
                Start-Sleep -Seconds $HoldSec
            }
            $record | Add-Member -NotePropertyName status -NotePropertyValue "ok"
            $results.Add($record) | Out-Null
            Write-Host ("Observed : host={0} tier={1} utf8={2} vt={3}" -f $record.observedHost, $record.tier, $record.utf8Active, $record.vtModeActive) -ForegroundColor Green
            Write-Host ("Log      : {0}" -f $record.logPath)
        }
        else {
            $timeoutResult = [pscustomobject]@{
                requestedHost = $hostKind
                status = "timeout"
                reason = "launcher start log not found"
                label = $label
            }
            $results.Add($timeoutResult) | Out-Null
            Write-WarnLine "No matching launcher log found within timeout"
        }
    }
    finally {
        if ($process) {
            Stop-ProcessTree -Process $process
            Start-Sleep -Milliseconds 400
        }
    }
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $reportPath -Encoding utf8

Write-Step "Summary"
$results | Format-Table -AutoSize requestedHost,observedHost,tier,utf8Active,vtModeActive,status,reason
Write-Host ""
Write-Host ("Report   : {0}" -f $reportPath) -ForegroundColor Cyan
