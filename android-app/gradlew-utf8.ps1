param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$GradleArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradleWrapper = Join-Path $scriptDir 'gradlew.bat'

if (-not (Test-Path $gradleWrapper)) {
    throw "未找到 Gradle Wrapper: $gradleWrapper"
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$null = & chcp.com 65001

$utf8JvmOptions = @(
    '-Dfile.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8',
    '-Dsun.stderr.encoding=UTF-8'
)

function Merge-JvmOptions {
    param([string]$Existing)

    $tokens = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($Existing)) {
        foreach ($part in ($Existing -split '\s+')) {
            if (-not [string]::IsNullOrWhiteSpace($part)) {
                $tokens.Add($part)
            }
        }
    }

    foreach ($option in $utf8JvmOptions) {
        if (-not $tokens.Contains($option)) {
            $tokens.Add($option)
        }
    }

    return [string]::Join(' ', $tokens)
}

$env:JAVA_TOOL_OPTIONS = Merge-JvmOptions $env:JAVA_TOOL_OPTIONS
$env:GRADLE_OPTS = Merge-JvmOptions $env:GRADLE_OPTS
$env:PYTHONIOENCODING = 'utf-8'

& $gradleWrapper @GradleArgs
exit $LASTEXITCODE
