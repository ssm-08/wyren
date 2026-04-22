: << 'CMDBLOCK'
@echo off
setlocal
node "%CLAUDE_PLUGIN_ROOT%\hooks\%1.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/$1.mjs"
exit $?
