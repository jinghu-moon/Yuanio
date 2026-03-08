$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path "docs/bench" | Out-Null
Get-ChildItem "docs/bench" -Filter "protocol-e2e-post-run*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
$results = @()
for ($i = 1; $i -le 10; $i++) {
  $port = 3400 + $i
  $server = "http://127.0.0.1:$port"
  $out = "docs/bench/protocol-e2e-post-run$($i).json"
  Write-Host "[run] $i/10 server=$server"
  cmd /c "bun run packages/cli/src/test-protocol-e2e-baseline.ts --server $server --out $out" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "run $i failed (exit=$LASTEXITCODE)" }
  $j = Get-Content $out -Raw | ConvertFrom-Json
  if ($j.status -ne 'pass') { throw "run $i status=$($j.status) error=$($j.error)" }
  $results += [pscustomobject]@{
    run = $i
    server = $server
    ackRttMs = [double]$j.metrics.ackRttMs
    recoveryPendingAppearMs = [double]$j.metrics.recoveryPendingAppearMs
    recoveryAckClearMs = [double]$j.metrics.recoveryAckClearMs
  }
}
$rawPath = "docs/bench/protocol-e2e-post-runs-raw.json"
$results | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $rawPath
Write-Host "saved raw -> $rawPath"
$results | Format-Table -AutoSize
