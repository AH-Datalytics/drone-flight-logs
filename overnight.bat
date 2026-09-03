@echo off
REM Unattended backfill of every drone-log source, safe to leave running overnight.
REM
REM Double-click this, then leave the window open. It holds the machine awake while it
REM works and releases it when finished, without changing any power setting. Closing the
REM window stops the run; nothing is lost, and running it again resumes where it stopped.

cd /d "%~dp0"
title Drone logs - overnight backfill

echo Holding the system awake for the duration of this run...
start "keep-awake" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\keep-awake.ps1"

call npx tsx pipeline/overnight.ts
set EXITCODE=%ERRORLEVEL%

taskkill /FI "WINDOWTITLE eq keep-awake*" /F >nul 2>&1

echo.
if "%EXITCODE%"=="0" (
  echo Done. Everything collected and rebuilt. Run "npm run dev" to look at it.
) else (
  echo Finished with at least one source incomplete. Run this file again to resume.
)
echo.
pause
