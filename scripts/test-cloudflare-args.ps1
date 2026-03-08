. "$PSScriptRoot/start-cloudflare.ps1"

$args1 = Build-CloudflaredArgs "tunnel-1" 0
$joined1 = $args1 -join " "
if ($joined1 -ne "tunnel run tunnel-1") {
  Write-Error "case1 失败: $joined1"
  exit 1
}

$args2 = Build-CloudflaredArgs "tunnel-2" 3
$joined2 = $args2 -join " "
if ($joined2 -ne "tunnel --retries 3 run tunnel-2") {
  Write-Error "case2 失败: $joined2"
  exit 1
}

Write-Host "test-cloudflare-args passed"
