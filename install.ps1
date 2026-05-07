<#
.SYNOPSIS
    Relay installer for Windows (PowerShell).

.DESCRIPTION
    Installs relay globally via npm, then wires Claude Code hooks.

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/ssm-08/relay/master/install.ps1 | iex
    .\install.ps1 --from-local .
    .\install.ps1 --dry-run
#>

param(
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$RelayArgs
)

$ErrorActionPreference = 'Stop'

# Node >= 20
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "[relay] ERROR: node not found on PATH. Install from https://nodejs.org/"
    exit 2
}
$nodeVer = & node -e "process.stdout.write(process.versions.node.split('.')[0])"
if ([int]$nodeVer -lt 20) {
    Write-Error "[relay] ERROR: Node $nodeVer found but >= 20 required. Install from https://nodejs.org/"
    exit 2
}

# npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Error "[relay] ERROR: npm not found on PATH. Install from https://nodejs.org/"
    exit 2
}

# Parse --from-local (dev installs only)
$fromLocal = $null
for ($i = 0; $i -lt $RelayArgs.Count; $i++) {
    if ($RelayArgs[$i] -eq '--from-local' -and $i + 1 -lt $RelayArgs.Count) {
        $fromLocal = $RelayArgs[$i + 1]
        break
    }
}

if ($fromLocal) {
    # Dev install: run installer directly from local checkout
    $installerPath = Join-Path (Resolve-Path $fromLocal) 'scripts\installer.mjs'
    & node $installerPath install @RelayArgs
    exit $LASTEXITCODE
}

# Standard install: npm global install, then wire hooks
Write-Host "[relay] Installing @ssm-08/relay globally..."
& npm install -g @ssm-08/relay
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& relay install @RelayArgs
exit $LASTEXITCODE
