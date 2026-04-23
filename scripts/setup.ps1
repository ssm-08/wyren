<#
.SYNOPSIS
    One-shot Relay plugin install / uninstall for a Windows machine.

.DESCRIPTION
    Phases (in order):
      0. Preflight    - verify Node >= 20, git, relay checkout
      1. Junction     - ~/.claude/plugins/relay -> <RelayRoot>
      2. Settings     - patch ~/.claude/settings.json with hook entries
      3. Target init  - relay init in <TargetRepo> (if given)
      4. Smoke        - run scripts/test-e2e.mjs (if -RunTests)
      5. Summary      - print final state

.PARAMETER RelayRoot
    Path to this relay checkout. Defaults to the directory containing this script.

.PARAMETER TargetRepo
    Optional: a git repo to run 'relay init' in.

.PARAMETER SkipSettingsPatch
    Skip patching ~/.claude/settings.json (expert use only).

.PARAMETER RunTests
    After install, run scripts/test-e2e.mjs and propagate its exit code.

.PARAMETER Uninstall
    Remove junction and strip relay hooks from settings.json.

.PARAMETER WhatIf
    Print intended actions without making any changes.

.EXAMPLE
    .\setup.ps1 -TargetRepo "C:\Users\Me\Documents\my-project" -RunTests
    .\setup.ps1 -WhatIf
    .\setup.ps1 -Uninstall
#>

param(
    [string]$RelayRoot       = (Split-Path $PSScriptRoot -Parent),
    [string]$TargetRepo      = '',
    [switch]$SkipSettingsPatch,
    [switch]$RunTests,
    [switch]$Uninstall,
    [switch]$WhatIf
)

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

$JUNCTION_PATH   = Join-Path $env:USERPROFILE '.claude\plugins\relay'
$SETTINGS_PATH   = Join-Path $env:USERPROFILE '.claude\settings.json'
$HOOK_CMD        = Join-Path $RelayRoot 'hooks\run-hook.cmd'
$STATUS_TAG      = 'relay-managed'  # marker embedded in hook command path check

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

function Write-Phase([string]$label, [string]$msg) {
    Write-Host "[relay] [$label] $msg"
}

function Write-Ok([string]$msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Skip([string]$msg) { Write-Host "  --  $msg" -ForegroundColor DarkGray }
function Write-Warn([string]$msg) { Write-Host "  !! $msg"  -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host " ERR $msg"  -ForegroundColor Red }

function Invoke-Preflight {
    Write-Phase 'Preflight' 'Checking dependencies and relay checkout'

    # Relay checkout sanity
    $markers = @(
        (Join-Path $RelayRoot 'bin\relay.mjs'),
        (Join-Path $RelayRoot 'hooks\run-hook.cmd'),
        (Join-Path $RelayRoot '.claude-plugin\plugin.json')
    )
    foreach ($m in $markers) {
        if (-not (Test-Path $m)) {
            Write-Err "Not a relay checkout  - missing $m"
            Write-Err 'Run from inside the relay repo or pass -RelayRoot [relay-root-path]'
            exit 1
        }
    }
    Write-Ok "Relay root: $RelayRoot"

    # Node >= 20
    $nodeVer = & node --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $nodeVer) {
        Write-Err 'node not found on PATH. Install Node.js >= 20.'
        exit 1
    }
    $major = [int]($nodeVer -replace 'v(\d+)\..*','$1')
    if ($major -lt 20) {
        Write-Err "Node $nodeVer found but >= 20 required."
        exit 1
    }
    Write-Ok "Node $nodeVer"

    # git
    $gitVer = & git --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'git not found on PATH.'
        exit 1
    }
    Write-Ok $gitVer

    # claude CLI (warn-only)
    $claudeVer = & claude --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'claude CLI not found  - distiller will fail at runtime. Install Claude Code first.'
    } else {
        Write-Ok "claude $claudeVer"
    }
}

function Get-JunctionTarget([string]$junctionPath) {
    # Returns the target of a junction/symlink as a string, or $null if not a reparse point.
    # PS 5.1: Get-Item .Target may return an array; take the first element.
    try {
        $item = Get-Item $junctionPath -Force -ErrorAction Stop
        if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
            $t = $item.Target
            if ($t -is [System.Array]) { $t = $t[0] }
            return [string]$t
        }
    } catch {}
    return $null
}

function Invoke-Junction {
    Write-Phase 'Junction' "~\.claude\plugins\relay -> $RelayRoot"

    if (Test-Path $JUNCTION_PATH) {
        $target = Get-JunctionTarget $JUNCTION_PATH
        if ($Uninstall) {
            if ($target -and ($target.TrimEnd('\') -eq $RelayRoot.TrimEnd('\'))) {
                if ($WhatIf) { Write-Skip "[WhatIf] Would remove junction $JUNCTION_PATH"; return }
                # Remove-Item -Force throws on PS 5.1 junctions; use cmd rmdir which only removes the junction entry
                & cmd /c rmdir /q "`"$JUNCTION_PATH`""
                Write-Ok 'Junction removed.'
            } else {
                Write-Warn "Junction at $JUNCTION_PATH points elsewhere ($target). Not removing."
            }
            return
        }
        if ($target -and ($target.TrimEnd('\') -eq $RelayRoot.TrimEnd('\'))) {
            Write-Skip 'Junction already correct  - skipping.'
            return
        }
        # Points elsewhere or is a regular dir
        Write-Err "$JUNCTION_PATH already exists and points to: $target"
        Write-Err 'Remove it manually or run with -Uninstall first.'
        exit 1
    }

    if ($Uninstall) { Write-Skip 'No junction to remove.'; return }

    if ($WhatIf) {
        Write-Skip "[WhatIf] Would create junction: $JUNCTION_PATH -> $RelayRoot"
        return
    }

    $pluginsDir = Split-Path $JUNCTION_PATH -Parent
    if (-not (Test-Path $pluginsDir)) { New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null }
    New-Item -ItemType Junction -Path $JUNCTION_PATH -Target $RelayRoot -Force | Out-Null
    Write-Ok "Junction created: $JUNCTION_PATH -> $RelayRoot"
}

function New-HookEntry([string]$hookName, [string]$hookPath) {
    # Returns a PSCustomObject matching the settings.json hook schema.
    $cmd = if ($hookName -eq 'SessionStart') {
        @{
            type          = 'command'
            command       = "`"$hookPath`" session-start"
            timeout       = 2
            statusMessage = 'Loading relay memory...'
        }
    } else {
        @{
            type    = 'command'
            command = "`"$hookPath`" stop"
            timeout = 5
        }
    }
    return [pscustomobject]@{
        matcher = ''
        hooks   = @($cmd)
    }
}

function Is-RelayHookEntry($entry, [string]$hookCmdPath) {
    # True if any hook command in this entry references run-hook.cmd
    foreach ($h in $entry.hooks) {
        if ($h.command -and $h.command.Contains('run-hook.cmd')) { return $true }
    }
    return $false
}

function Get-SettingsJson {
    if (-not (Test-Path $SETTINGS_PATH)) { return [pscustomobject]@{} }
    try {
        $raw = Get-Content $SETTINGS_PATH -Raw -Encoding UTF8
        return $raw | ConvertFrom-Json
    } catch {
        Write-Err "Failed to parse $SETTINGS_PATH : $_"
        exit 1
    }
}

function ConvertTo-JsonDeep($obj) {
    return $obj | ConvertTo-Json -Depth 20
}

function Invoke-SettingsPatch {
    if ($SkipSettingsPatch) { Write-Skip 'Settings patch skipped (-SkipSettingsPatch).'; return }

    Write-Phase 'Settings' $SETTINGS_PATH

    $existed = Test-Path $SETTINGS_PATH
    $settings = Get-SettingsJson

    # Ensure .hooks exists as a PSCustomObject-compatible structure
    if (-not $settings.PSObject.Properties['hooks']) {
        $settings | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ([pscustomobject]@{})
    }
    $hooks = $settings.hooks

    foreach ($event in @('SessionStart', 'Stop')) {
        if (-not $hooks.PSObject.Properties[$event]) {
            $hooks | Add-Member -NotePropertyName $event -NotePropertyValue @()
        }

        # Current entries for this event (may be array or single item from ConvertFrom-Json)
        $current = @($hooks.$event)

        if ($Uninstall) {
            $filtered = @($current | Where-Object { -not (Is-RelayHookEntry $_ $HOOK_CMD) })
            if ($filtered.Count -eq $current.Count) {
                Write-Skip "$event : no relay entries found."
            } else {
                $hooks.$event = $filtered
                Write-Ok "$event : removed relay entries."
            }
        } else {
            # Remove stale relay entries, add fresh
            $filtered = @($current | Where-Object { -not (Is-RelayHookEntry $_ $HOOK_CMD) })
            $fresh = New-HookEntry $event $HOOK_CMD
            $hooks.$event = @($filtered) + @($fresh)
            Write-Ok "$event : relay hook registered."
        }
    }

    # Clean up empty hook events
    if ($Uninstall) {
        foreach ($event in @('SessionStart', 'Stop')) {
            if ($hooks.PSObject.Properties[$event] -and @($hooks.$event).Count -eq 0) {
                $hooks.PSObject.Properties.Remove($event)
            }
        }
        $remaining = @($hooks.PSObject.Properties | Where-Object { $_.Name -ne '_comment' })
        if ($remaining.Count -eq 0) {
            $settings.PSObject.Properties.Remove('hooks')
        }
    }

    if ($WhatIf) {
        Write-Skip '[WhatIf] Would write settings.json:'
        Write-Skip (ConvertTo-JsonDeep $settings)
        return
    }

    # Backup only if file existed and actually has content worth preserving
    if ($existed) {
        $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backup = "$SETTINGS_PATH.relay-backup-$ts"
        Copy-Item $SETTINGS_PATH $backup -Force
        Write-Skip "Backup: $backup"
    }

    $settingsDir = Split-Path $SETTINGS_PATH -Parent
    if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null }
    ConvertTo-JsonDeep $settings | Set-Content $SETTINGS_PATH -Encoding UTF8
    Write-Ok "settings.json written."
}

function Invoke-TargetInit {
    if (-not $TargetRepo -or $Uninstall) { return }

    Write-Phase 'Target init' $TargetRepo

    $abs = [System.IO.Path]::GetFullPath($TargetRepo)
    if (-not (Test-Path $abs -PathType Container)) {
        Write-Err "TargetRepo not found: $abs"
        exit 1
    }
    if (-not (Test-Path (Join-Path $abs '.git'))) {
        Write-Err "TargetRepo is not a git repository: $abs"
        exit 1
    }

    if ($WhatIf) { Write-Skip "[WhatIf] Would run: node bin/relay.mjs init in $abs"; return }

    $relayMjs = Join-Path $RelayRoot 'bin\relay.mjs'
    $r = & node $relayMjs init 2>&1
    $exitCode = $LASTEXITCODE
    Write-Host "  $r"
    if ($exitCode -ne 0) { Write-Warn "relay init exited $exitCode" }
    else { Write-Ok "relay init complete." }
}

function Invoke-Smoke {
    if (-not $RunTests) { return }
    Write-Phase 'Smoke' 'Running scripts/test-e2e.mjs'
    if ($WhatIf) { Write-Skip '[WhatIf] Would run test-e2e.mjs'; return }

    $testScript = Join-Path $RelayRoot 'scripts\test-e2e.mjs'
    & node $testScript
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Err "test-e2e.mjs failed (exit $code)"
        exit $code
    }
    Write-Ok 'All e2e tests passed.'
}

function Invoke-Summary {
    Write-Host ''
    Write-Phase 'Summary' '-------------------------------------'
    Write-Host "  Relay root : $RelayRoot"
    Write-Host "  Junction   : $JUNCTION_PATH"
    Write-Host "  Settings   : $SETTINGS_PATH"
    if ($TargetRepo) { Write-Host "  Target repo: $TargetRepo" }

    if (-not $Uninstall) {
        Write-Host ''
        Write-Host '  Next steps:'
        Write-Host '    1. Open a Claude Code session in your target repo.'
        if ($TargetRepo) {
            Write-Host "       cd `"$TargetRepo`""
        }
        Write-Host "    2. Expect status: 'Loading relay memory...' on session start."
        Write-Host '    3. After 5+ turns, check: relay status'
        Write-Host '       .relay/state/watermark.json should show turns_since_distill incrementing.'
    }
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

try { Invoke-Preflight }       catch { Write-Err "Preflight: $_"; exit 1 }
try { Invoke-Junction }        catch { Write-Err "Junction: $_"; exit 1 }
try { Invoke-SettingsPatch }   catch { Write-Err "Settings: $_"; exit 1 }
try { Invoke-TargetInit }      catch { Write-Err "Target init: $_"; exit 1 }
try { Invoke-Smoke }           catch { Write-Err "Smoke: $_"; exit 1 }
Invoke-Summary
