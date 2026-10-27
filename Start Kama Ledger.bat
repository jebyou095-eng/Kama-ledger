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
rem Kamo's live voice engine (about 90 MB, downloaded once). If it fails, Kamo still talks with his recorded voice.
if not exist "voice-engine\kokoro.int8.onnx.part3" if not exist "voice-engine\kokoro.int8.onnx" (
  echo Downloading Kamo's voice engine, about 90 MB, once...
  if not exist voice-engine mkdir voice-engine
  powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { foreach($i in 1,2,3){ Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/jebyou095-eng/kama-ledger/main/voice-engine-download/kokoro.int8.onnx.part'+$i) -OutFile ('voice-engine\kokoro.int8.onnx.dl'+$i) }; foreach($i in 1,2,3){ Move-Item -Force ('voice-engine\kokoro.int8.onnx.dl'+$i) ('voice-engine\kokoro.int8.onnx.part'+$i) } } catch { Write-Host 'Voice engine download failed; Kamo will use his recorded voice.'; Remove-Item 'voice-engine\*.dl*' -ErrorAction SilentlyContinue }"
)
call npm run build > build-log.txt 2>&1
if errorlevel 1 (
  echo The build failed. Repairing the installation once, needs internet, takes a few minutes...
  if exist node_modules rmdir /s /q node_modules
  call npm install
  call node node_modules\electron\install.js
  call npm run build > build-log.txt 2>&1
)
if errorlevel 1 (
  echo.
  echo Build failed again. The reason is saved in build-log.txt in this folder. Last lines:
  echo ----------------------------------------
  powershell -NoProfile -Command "Get-Content build-log.txt -Tail 15"
  echo ----------------------------------------
  echo Send me a photo of this window or the build-log.txt file.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
