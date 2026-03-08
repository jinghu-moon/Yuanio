param(
  [string]$RelayUrl = "http://127.0.0.1:3000",
  [string]$WebhookLocalUrl = "http://127.0.0.1:8787/telegram/webhook",
  [string]$WebhookSecret = "",
  [string]$ChatId = "",
  [string]$BotToken = "",
  [switch]$SkipWebhookInfo
)

$ErrorActionPreference = "Stop"

function Add-Result {
  param(
    [string]$Name,
    [bool]$Ok,
    [string]$Detail
  )
  $script:Results += [pscustomobject]@{
    Check  = $Name
    Result = if ($Ok) { "PASS" } else { "FAIL" }
    Detail = $Detail
  }
}

function Add-Skip {
  param(
    [string]$Name,
    [string]$Detail
  )
  $script:Results += [pscustomobject]@{
    Check  = $Name
    Result = "SKIP"
    Detail = $Detail
  }
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [hashtable]$Body,
    [hashtable]$Headers = @{}
  )
  $json = ($Body | ConvertTo-Json -Depth 8 -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Method = "POST"
  $req.ContentType = "application/json"
  $req.Timeout = 6000
  $req.ReadWriteTimeout = 6000
  $req.ContentLength = $bytes.Length
  foreach ($k in $Headers.Keys) {
    $req.Headers.Add([string]$k, [string]$Headers[$k])
  }

  $stream = $req.GetRequestStream()
  try {
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Close()
  }

  try {
    $resp = [System.Net.HttpWebResponse]$req.GetResponse()
    try {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      try {
        $bodyText = $reader.ReadToEnd()
      } finally {
        $reader.Close()
      }
    } finally {
      $resp.Close()
    }
    return [pscustomobject]@{
      Status = [int]$resp.StatusCode
      Body   = [string]$bodyText
    }
  } catch [System.Net.WebException] {
    if (-not $_.Exception.Response) {
      throw
    }
    $resp = [System.Net.HttpWebResponse]$_.Exception.Response
    try {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      try {
        $bodyText = $reader.ReadToEnd()
      } finally {
        $reader.Close()
      }
    } finally {
      $resp.Close()
    }
    return [pscustomobject]@{
      Status = [int]$resp.StatusCode
      Body   = [string]$bodyText
    }
  }
}

function Load-Keys {
  $path = Join-Path $HOME ".yuanio/keys.json"
  if (-not (Test-Path $path)) {
    return $null
  }
  try {
    return Get-Content $path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Mask-Token {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "(empty)" }
  if ($Value.Length -le 10) { return "***" }
  return "{0}...{1}" -f $Value.Substring(0, 6), $Value.Substring($Value.Length - 4)
}

$script:Results = @()
$keys = Load-Keys

if ([string]::IsNullOrWhiteSpace($ChatId) -and $keys -and $keys.telegramChatId) {
  $ChatId = [string]$keys.telegramChatId
}
if ([string]::IsNullOrWhiteSpace($BotToken) -and $keys -and $keys.telegramBotToken) {
  $BotToken = [string]$keys.telegramBotToken
}
if ([string]::IsNullOrWhiteSpace($WebhookSecret) -and $env:YUANIO_TELEGRAM_WEBHOOK_SECRET) {
  $WebhookSecret = [string]$env:YUANIO_TELEGRAM_WEBHOOK_SECRET
}

Write-Host "== Telegram Flow Smoke Test ==" -ForegroundColor Cyan
Write-Host ("Relay URL       : {0}" -f $RelayUrl)
Write-Host ("Webhook URL     : {0}" -f $WebhookLocalUrl)
Write-Host ("Chat ID         : {0}" -f ($(if ($ChatId) { $ChatId } else { "(missing)" })))
Write-Host ("Bot Token       : {0}" -f (Mask-Token $BotToken))
Write-Host ("Webhook Secret  : {0}" -f ($(if ($WebhookSecret) { "(set)" } else { "(empty)" })))
Write-Host ""

$updateSeed = Get-Random -Minimum 900000 -Maximum 999000
$messageSeed = Get-Random -Minimum 10000 -Maximum 99900

# 1) Relay health
try {
  $health = Invoke-RestMethod -Uri "$RelayUrl/health" -Method GET -TimeoutSec 5
  $ok = ($health.status -eq "ok")
  Add-Result "relay-health" $ok ("status={0}" -f $health.status)
} catch {
  Add-Result "relay-health" $false $_.Exception.Message
}

# 2) webhook secret check (optional)
if ([string]::IsNullOrWhiteSpace($WebhookSecret)) {
  Add-Skip "webhook-secret-401" "WebhookSecret 未提供，跳过 401 校验"
} else {
  try {
    $r = Invoke-JsonPost -Url $WebhookLocalUrl -Body @{
      update_id = $updateSeed + 1
      message   = @{
        message_id = $messageSeed + 1
        chat       = @{ id = $ChatId }
        text       = "/status"
      }
    }
    Add-Result "webhook-secret-401" ($r.Status -eq 401) ("status={0} body={1}" -f $r.Status, $r.Body)
  } catch {
    Add-Result "webhook-secret-401" $false $_.Exception.Message
  }
}

# 3) webhook chat allowlist check (optional)
if ([string]::IsNullOrWhiteSpace($WebhookSecret)) {
  Add-Skip "webhook-chat-ignored" "WebhookSecret 未提供，跳过 chat allowlist 校验"
} else {
  try {
    $r = Invoke-JsonPost -Url $WebhookLocalUrl -Headers @{
      "x-telegram-bot-api-secret-token" = $WebhookSecret
    } -Body @{
      update_id = $updateSeed + 2
      message   = @{
        message_id = $messageSeed + 2
        chat       = @{ id = 1234567890 }
        text       = "/status"
      }
    }
    $ok = ($r.Status -eq 200 -and $r.Body -eq "ignored")
    Add-Result "webhook-chat-ignored" $ok ("status={0} body={1}" -f $r.Status, $r.Body)
  } catch {
    Add-Result "webhook-chat-ignored" $false $_.Exception.Message
  }
}

# 4) webhook accepts valid /status
if ([string]::IsNullOrWhiteSpace($ChatId)) {
  Add-Skip "webhook-status-accepted" "ChatId 缺失，跳过 /status 投递"
} else {
  try {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($WebhookSecret)) {
      $headers["x-telegram-bot-api-secret-token"] = $WebhookSecret
    }
    $r = Invoke-JsonPost -Url $WebhookLocalUrl -Headers $headers -Body @{
      update_id = $updateSeed + 3
      message   = @{
        message_id = $messageSeed + 3
        chat       = @{ id = $ChatId }
        text       = "/status"
      }
    }
    Add-Result "webhook-status-accepted" ($r.Status -eq 200 -and $r.Body -eq "ok") ("status={0} body={1}" -f $r.Status, $r.Body)
  } catch {
    Add-Result "webhook-status-accepted" $false $_.Exception.Message
  }
}

# 5) webhook accepts normal prompt
if ([string]::IsNullOrWhiteSpace($ChatId)) {
  Add-Skip "webhook-prompt-accepted" "ChatId 缺失，跳过 prompt 投递"
} else {
  try {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($WebhookSecret)) {
      $headers["x-telegram-bot-api-secret-token"] = $WebhookSecret
    }
    $prompt = "telegram smoke prompt " + (Get-Date -Format "yyyyMMdd-HHmmss")
    $r = Invoke-JsonPost -Url $WebhookLocalUrl -Headers $headers -Body @{
      update_id = $updateSeed + 4
      message   = @{
        message_id = $messageSeed + 4
        chat       = @{ id = $ChatId }
        text       = $prompt
      }
    }
    Add-Result "webhook-prompt-accepted" ($r.Status -eq 200 -and $r.Body -eq "ok") ("status={0} body={1}" -f $r.Status, $r.Body)
  } catch {
    Add-Result "webhook-prompt-accepted" $false $_.Exception.Message
  }
}

# 6) webhook accepts /clear
if ([string]::IsNullOrWhiteSpace($ChatId)) {
  Add-Skip "webhook-clear-accepted" "ChatId 缺失，跳过 /clear 投递"
} else {
  try {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($WebhookSecret)) {
      $headers["x-telegram-bot-api-secret-token"] = $WebhookSecret
    }
    $r = Invoke-JsonPost -Url $WebhookLocalUrl -Headers $headers -Body @{
      update_id = $updateSeed + 5
      message   = @{
        message_id = $messageSeed + 5
        chat       = @{ id = $ChatId }
        text       = "/clear"
      }
    }
    Add-Result "webhook-clear-accepted" ($r.Status -eq 200 -and $r.Body -eq "ok") ("status={0} body={1}" -f $r.Status, $r.Body)
  } catch {
    Add-Result "webhook-clear-accepted" $false $_.Exception.Message
  }
}

# 7) webhook accepts /loop
if ([string]::IsNullOrWhiteSpace($ChatId)) {
  Add-Skip "webhook-loop-accepted" "ChatId 缺失，跳过 /loop 投递"
} else {
  try {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($WebhookSecret)) {
      $headers["x-telegram-bot-api-secret-token"] = $WebhookSecret
    }
    $r = Invoke-JsonPost -Url $WebhookLocalUrl -Headers $headers -Body @{
      update_id = $updateSeed + 6
      message   = @{
        message_id = $messageSeed + 6
        chat       = @{ id = $ChatId }
        text       = "/loop smoke loop from script"
      }
    }
    Add-Result "webhook-loop-accepted" ($r.Status -eq 200 -and $r.Body -eq "ok") ("status={0} body={1}" -f $r.Status, $r.Body)
  } catch {
    Add-Result "webhook-loop-accepted" $false $_.Exception.Message
  }
}

# 8) telegram api webhook info (optional)
if ($SkipWebhookInfo) {
  Add-Skip "telegram-getWebhookInfo" "SkipWebhookInfo 指定，跳过"
} elseif ([string]::IsNullOrWhiteSpace($BotToken)) {
  Add-Skip "telegram-getWebhookInfo" "BotToken 缺失，跳过"
} else {
  try {
    $api = "https://api.telegram.org/bot{0}/getWebhookInfo" -f $BotToken
    $info = Invoke-RestMethod -Uri $api -Method GET -TimeoutSec 8
    $ok = ($info.ok -eq $true)
    $url = $info.result.url
    $pending = $info.result.pending_update_count
    Add-Result "telegram-getWebhookInfo" $ok ("url={0} pending={1}" -f $url, $pending)
  } catch {
    Add-Result "telegram-getWebhookInfo" $false $_.Exception.Message
  }
}

Write-Host ""
$Results | Format-Table -AutoSize | Out-String -Width 4096 | Write-Host

$failCount = @($Results | Where-Object { $_.Result -eq "FAIL" }).Count
if ($failCount -gt 0) {
  Write-Host ("FAIL: {0} checks failed." -f $failCount) -ForegroundColor Red
  exit 1
}

Write-Host "PASS: no failed checks." -ForegroundColor Green
exit 0
