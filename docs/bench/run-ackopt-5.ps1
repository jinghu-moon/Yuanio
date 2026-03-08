$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path "docs/bench" | Out-Null
Get-ChildItem "docs/bench" -Filter "protocol-e2e-ackopt-run*.json" -ErrorAction SilentlyContinue | Remove-Item -Force

function Wait-RelayHealthy([string]$serverUrl, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    try {
      $resp = Invoke-RestMethod -Uri "$serverUrl/health" -Method Get -TimeoutSec 2
      if ($resp.status -eq 'ok' -or $resp.ok -eq $true) { return $true }
    } catch {}
  }
  return $false
}

$results = @()
for ($i = 1; $i -le 5; $i++) {
  $port = 3500 + $i
  $server = "http://127.0.0.1:$port"
  $out = "docs/bench/protocol-e2e-ackopt-run$($i).json"
  $relayOut = "docs/bench/protocol-e2e-ackopt-run$($i)-relay.out.log"
  $relayErr = "docs/bench/protocol-e2e-ackopt-run$($i)-relay.err.log"

  $relay = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "set PORT=$port && bun run packages/relay-server/src/index.ts" -NoNewWindow -PassThru -RedirectStandardOutput $relayOut -RedirectStandardError $relayErr -WorkingDirectory (Get-Location)
  try {
    if (-not (Wait-RelayHealthy -serverUrl $server -timeoutSec 20)) { throw "run $i relay health timeout" }
    cmd /c "bun run packages/cli/src/test-protocol-e2e-baseline.ts --server $server --no-auto-relay --out $out" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "run $i failed (exit=$LASTEXITCODE)" }
    $j = Get-Content $out -Raw | ConvertFrom-Json
    if ($j.status -ne 'pass') { throw "run $i status=$($j.status) error=$($j.error)" }
    $results += [pscustomobject]@{
      run = $i
      ackRttMs = [double]$j.metrics.ackRttMs
      recoveryPendingAppearMs = [double]$j.metrics.recoveryPendingAppearMs
      recoveryAckClearMs = [double]$j.metrics.recoveryAckClearMs
    }
  }
  finally {
    if ($relay -and -not $relay.HasExited) { Stop-Process -Id $relay.Id -Force }
  }
}
$rawPath = "docs/bench/protocol-e2e-ackopt-runs-raw.json"
$results | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $rawPath
$results | Format-Table -AutoSize
