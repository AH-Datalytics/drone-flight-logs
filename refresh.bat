@echo off
REM Monthly refresh for the police drone flight logs site.
REM Register with Task Scheduler to run on the 1st of each month:
REM   schtasks /create /tn "drone-logs-refresh" /tr "C:\Users\jeffm\police-drone-logs\refresh.bat" /sc monthly /d 1 /st 02:00
REM Two of the five sources publish only a recent window, so a month missed is
REM a month of those agencies lost for good.
cd /d "%~dp0"
call npm run refresh
