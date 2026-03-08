param(
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
    & $Action
}

function Assert-LastExitCode {
    param(
        [Parameter(Mandatory = $true)][string]$StepName
    )

    if ($LASTEXITCODE -ne 0) {
        throw "$StepName failed with exit code $LASTEXITCODE"
    }
}

$root = (Resolve-Path "$PSScriptRoot/..").Path
$androidDir = Join-Path $root "android-app"
$apkPath = Join-Path $root "android-app/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk"

Invoke-Step -Title "Run stream gate tests (dispatch + replay)" -Action {
    Push-Location $root
    try {
        bun run --cwd "packages/cli" test:stream-gate
        Assert-LastExitCode -StepName "Stream gate tests"
    } finally {
        Pop-Location
    }
}

Invoke-Step -Title "Build Android Debug APK (arm64-v8a)" -Action {
    Push-Location $androidDir
    try {
        & ".\gradlew.bat" "assembleDebug"
        Assert-LastExitCode -StepName "Gradle assembleDebug"
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $apkPath)) {
    throw "APK not found: $apkPath"
}

if ($SkipInstall) {
    Write-Host ""
    Write-Host "[OK] Tests and build passed. Install skipped." -ForegroundColor Green
    Write-Host "APK: $apkPath"
    exit 0
}

Invoke-Step -Title "Install Debug APK via ADB" -Action {
    $adb = Get-Command "adb" -ErrorAction SilentlyContinue
    if (-not $adb) {
        throw "adb not found. Install Android Platform Tools and add adb to PATH."
    }

    & "adb" "install" "-r" $apkPath
    Assert-LastExitCode -StepName "adb install"
}

Write-Host ""
Write-Host "[OK] Stream gate passed and APK installed." -ForegroundColor Green
