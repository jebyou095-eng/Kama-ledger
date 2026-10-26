@echo off
rem Prints the config block to paste into Claude Desktop (Settings > Developer > Edit config).
cd /d "%~dp0"
node mcp\print-config.mjs
echo.
pause
