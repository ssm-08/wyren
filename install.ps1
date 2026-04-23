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
    [string[]]$Args
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
for ($i = 0; $i -lt $Args.Count; $i++) {
    if ($Args[$i] -eq '--from-local' -and $i + 1 -lt $Args.Count) {
        $fromLocal = $Args[$i + 1]
        break
    }
}

if (-not $fromLocal -and -not (Test-Path $clone)) {
    Write-Host "[relay] Cloning relay into $clone ..."
    & git clone --depth=1 https://github.com/ssm-08/relay $clone
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$installerBase = if ($fromLocal) { $fromLocal } else { $clone }
$installerPath = Join-Path $installerBase 'scripts\installer.mjs'

& node $installerPath install @Args
exit $LASTEXITCODE
