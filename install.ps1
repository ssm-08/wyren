<#
.SYNOPSIS
    Relay installer for Windows (PowerShell).

.DESCRIPTION
    One-shot install: detects Node >= 20, clones repo to ~/.claude/relay/ if
    needed, then calls scripts/installer.mjs install with all args forwarded.

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/ssm-08/relay/master/install.ps1 | iex
    .\install.ps1 --from-local . --home "$env:TEMP\fake-home"
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

# git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Error "[relay] ERROR: git not found on PATH. Install from https://git-scm.com/"
    exit 2
}

$claudeHome = if ($env:RELAY_HOME) { $env:RELAY_HOME } elseif ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $env:USERPROFILE '.claude' }
$clone = Join-Path $claudeHome 'relay'

# Parse --from-local
$fromLocal = $null
for ($i = 0; $i -lt $RelayArgs.Count; $i++) {
    if ($RelayArgs[$i] -eq '--from-local' -and $i + 1 -lt $RelayArgs.Count) {
        $fromLocal = $RelayArgs[$i + 1]
        break
    }
}

# Bootstrap: need the installer script before we can call it.
# For --from-local the source is already on disk.
# For standard install, clone only enough to get the installer (sparse),
# then hand off to installer.mjs which handles the full install lifecycle.
if (-not $fromLocal -and -not (Test-Path $clone)) {
    Write-Host "[relay] Bootstrapping relay installer..."
    & git clone --depth=1 --filter=blob:none --sparse https://github.com/ssm-08/relay "$clone"
    if ($LASTEXITCODE -ne 0) {
        # Sparse clone not supported — fall back to full clone
        & git clone --depth=1 https://github.com/ssm-08/relay "$clone"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } else {
        # Bootstrap: only need scripts/ to get installer.mjs — installer.mjs handles the full clone.
        & git -C "$clone" sparse-checkout set scripts
    }
}

$installerBase = if ($fromLocal) { $fromLocal } else { $clone }
$installerPath = Join-Path $installerBase 'scripts\installer.mjs'

& node $installerPath install @RelayArgs
exit $LASTEXITCODE
