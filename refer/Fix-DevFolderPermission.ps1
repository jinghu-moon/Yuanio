#Requires -RunAsAdministrator

<#
.SYNOPSIS
    修复开发目录权限
.DESCRIPTION
    递归地获取指定目录的所有权，并将该目录及其子项的完全控制权限授予当前用户。
.EXAMPLE
    .\Fix-DevFolderPermission.ps1 -Path "D:\Projects\MyApp"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, ValueFromPipeline = $true, ValueFromPipelineByPropertyName = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Path
)

# ------------------------------
# Fix-DevFolderPermission.ps1
# ------------------------------

# 1. 转换为绝对路径，避免 takeown/icacls 遇到相对路径时出错
if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "[X] 路径不存在: $Path"
    exit 1
}
$ResolvedPath = Convert-Path -LiteralPath $Path

# 2. 获取当前用户 (比使用环境变量更可靠)
$User = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host ""
Write-Host "[*] 修复开发目录权限" -ForegroundColor Cyan
Write-Host "[+] 目标路径: $ResolvedPath" -ForegroundColor Yellow
Write-Host "[@] 当前用户: $User" -ForegroundColor Green
Write-Host "[!] 警告: 这将递归地获取所有权，并授予当前用户完全控制权限。" -ForegroundColor Red
Write-Host ""

# 3. 确认提示
$confirm = Read-Host "请输入 YES 以继续"
if ($confirm -cne "YES") { 
    Write-Host "[-] 操作已取消。" -ForegroundColor DarkGray
    exit 0
}

Write-Host ""
try {
    Write-Host "[>] 正在获取所有权..." -ForegroundColor Cyan
    # 将标准错误(2)重定向到标准输出(1)，以便捕获隐藏的错误
    takeown.exe /f $ResolvedPath /r /d y 2>&1 | Out-Null

    Write-Host "[>] 正在授予完全控制权限..." -ForegroundColor Cyan
    # 增加 /q 静默模式，提高处理大量文件时的执行速度
    icacls.exe $ResolvedPath /grant "${User}:(OI)(CI)F" /t /c /q 2>&1 | Out-Null

    Write-Host ""
    Write-Host "[√] 权限修复成功！" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Error "[X] 应用权限时发生错误: $_"
    exit 1
}

Write-Host ""