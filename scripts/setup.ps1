<#
.SYNOPSIS
    DEPRECATED — use install.ps1 instead.

.DESCRIPTION
    This script has been replaced by install.ps1 + scripts/installer.mjs.
    Run: .\install.ps1 [--from-local <path>] [--dry-run]

    setup.ps1 will be removed in the next release.
#>

Write-Host "[relay] setup.ps1 is deprecated. Use install.ps1 instead." -ForegroundColor Yellow
Write-Host "  Running: install.ps1 $args" -ForegroundColor DarkGray

$installPs1 = Join-Path (Split-Path $PSScriptRoot -Parent) 'install.ps1'
if (-not (Test-Path $installPs1)) {
    Write-Error "install.ps1 not found at $installPs1. Please re-clone the relay repo."
    exit 1
}

& powershell -ExecutionPolicy Bypass -File $installPs1 @args
exit $LASTEXITCODE
