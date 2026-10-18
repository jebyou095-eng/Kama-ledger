@echo off
cd /d "%~dp0"
title Kama Ledger
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then double-click this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First launch: installing, this takes a few minutes and needs internet once...
  call npm install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)
rem Newer npm versions skip install scripts, so the Electron program may not have been downloaded. Fetch it explicitly.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading the Electron runtime, needs internet once...
  call node node_modules\electron\install.js
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Could not get the Electron runtime. Check your internet connection, delete the node_modules folder and run this file again.
  pause
  exit /b 1
)
call npm run build >nul 2>&1
if errorlevel 1 ( echo Build failed, run "npm run build" to see why. & pause & exit /b 1 )
start "" "node_modules\electron\dist\electron.exe" .
