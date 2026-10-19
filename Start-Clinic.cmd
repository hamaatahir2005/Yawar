@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "YAWAR_NODE=%~dp0runtime\node.exe"
if exist "%YAWAR_NODE%" goto launch
set "YAWAR_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org then open this file again.
  pause
  exit /b 1
)
echo Yawar Dental Clinic - keep this window open while the clinic is in use.
:launch
"%YAWAR_NODE%" scripts\launch.js
if errorlevel 1 pause
