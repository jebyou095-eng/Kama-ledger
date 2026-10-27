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
  rem curl.exe is built into Windows 10 and 11 and is fast; the old PowerShell download crawled because of its progress bar.
  echo Part 1 of 3: && curl.exe -L -f -# -o "voice-engine\kokoro.int8.onnx.dl1" "https://raw.githubusercontent.com/jebyou095-eng/kama-ledger/main/voice-engine-download/kokoro.int8.onnx.part1" && echo Part 2 of 3: && curl.exe -L -f -# -o "voice-engine\kokoro.int8.onnx.dl2" "https://raw.githubusercontent.com/jebyou095-eng/kama-ledger/main/voice-engine-download/kokoro.int8.onnx.part2" && echo Part 3 of 3: && curl.exe -L -f -# -o "voice-engine\kokoro.int8.onnx.dl3" "https://raw.githubusercontent.com/jebyou095-eng/kama-ledger/main/voice-engine-download/kokoro.int8.onnx.part3" && (
    move /y "voice-engine\kokoro.int8.onnx.dl1" "voice-engine\kokoro.int8.onnx.part1" >nul
    move /y "voice-engine\kokoro.int8.onnx.dl2" "voice-engine\kokoro.int8.onnx.part2" >nul
    move /y "voice-engine\kokoro.int8.onnx.dl3" "voice-engine\kokoro.int8.onnx.part3" >nul
    echo Voice engine ready.
  ) || (
    echo Voice engine download failed; Kamo will use his recorded voice. It will retry next launch.
    del /q "voice-engine\*.dl*" >nul 2>&1
  )
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
