@echo off
cd /d "%~dp0"
set "YAWAR_NODE=%~dp0runtime\node.exe"
if not exist "%YAWAR_NODE%" set "YAWAR_NODE=node"
"%YAWAR_NODE%" scripts\backup.js
if errorlevel 1 (
  echo Backup failed. Do not rely on it until the error is resolved.
) else (
  echo Verified backup saved in data\backups unless BACKUP_DIR is configured.
)
pause
