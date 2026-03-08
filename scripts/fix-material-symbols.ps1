param(
  [string]$DrawableDir = "android-app/app/src/main/res/drawable",
  [string]$Pattern = "ic_ms_*.xml"
)

$ErrorActionPreference = "Stop"

$dir = (Resolve-Path $DrawableDir).Path
$files = Get-ChildItem -Path $dir -Filter $Pattern -File
if (-not $files) {
  Write-Host "No files matched: $dir/$Pattern"
  exit 0
}

$updated = 0
foreach ($f in $files) {
  $raw = Get-Content -Path $f.FullName -Raw
  $next = $raw
  $next = $next -replace 'viewportWidth="24"', 'viewportWidth="960"'
  $next = $next -replace 'viewportHeight="24"', 'viewportHeight="960"'

  if ($next -notmatch "<group") {
    $groupLine = "`n    <group android:translateY=`"960`">`n"
    $next = [regex]::Replace(
      $next,
      "<vector[^>]*>\\s*",
      { param($m) $m.Value + $groupLine },
      1
    )
    $next = $next -replace "</vector>", "    </group>`n</vector>"
  }

  if ($next -ne $raw) {
    Set-Content -Path $f.FullName -Value $next
    $updated++
  }
}

Write-Host "Updated $updated file(s)."
