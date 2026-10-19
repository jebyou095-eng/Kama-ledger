@echo off
title Reset Kama Ledger data
echo This erases ALL Kama Ledger data on this computer:
echo items, ingredients, prices, ledger, captures, scan regions and settings.
echo Close Kama Ledger first.
set /p OK=Type YES to continue: 
if /i not "%OK%"=="YES" ( echo Cancelled. & pause & exit /b 0 )
if exist "%APPDATA%\kama-ledger" rmdir /s /q "%APPDATA%\kama-ledger"
if exist "%APPDATA%\Kama Ledger" rmdir /s /q "%APPDATA%\Kama Ledger"
echo Done. Start Kama Ledger again for a clean start.
pause
