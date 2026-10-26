@echo off
rem Drag claude_desktop_config.json onto this file. It adds kama-ledger to it and keeps a backup.
cd /d "%~dp0"
node mcp\install-config.mjs %1
echo.
pause
