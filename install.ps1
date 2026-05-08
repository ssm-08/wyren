<#
.SYNOPSIS
    Wyren installer for Windows (PowerShell).

.DESCRIPTION
    Installs wyren globally via npm, then wires Claude Code hooks.

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/ssm-08/wyren/master/install.ps1 | iex
    .\install.ps1 --from-local .
    .\install.ps1 --dry-run
#>

param(
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$WyrenArgs
)

$ErrorActionPreference = 'Stop'

# Node >= 20
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "[wyren] ERROR: node not found on PATH. Install from https://nodejs.org/"
    exit 2
}
$nodeVer = & node -e "process.stdout.write(process.versions.node.split('.')[0])"
if ([int]$nodeVer -lt 20) {
    Write-Error "[wyren] ERROR: Node $nodeVer found but >= 20 required. Install from https://nodejs.org/"
    exit 2
}

# npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Error "[wyren] ERROR: npm not found on PATH. Install from https://nodejs.org/"
    exit 2
}

# Parse --from-local (dev installs only)
$fromLocal = $null
for ($i = 0; $i -lt $WyrenArgs.Count; $i++) {
    if ($WyrenArgs[$i] -eq '--from-local' -and $i + 1 -lt $WyrenArgs.Count) {
        $fromLocal = $WyrenArgs[$i + 1]
        break
    }
}

if ($fromLocal) {
    # Dev install: run installer directly from local checkout
    $installerPath = Join-Path (Resolve-Path $fromLocal) 'scripts\installer.mjs'
    & node $installerPath install @WyrenArgs
    exit $LASTEXITCODE
}

# Standard install: npm global install, then wire hooks
Write-Host "[wyren] Installing @ssm-08/wyren globally..."
& npm install -g @ssm-08/wyren
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& wyren install @WyrenArgs
exit $LASTEXITCODE
