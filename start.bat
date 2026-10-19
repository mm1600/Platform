@echo off
REM Scope launcher for Windows: double-click.
REM With Node.js installed it serves the folder on http://localhost:8130;
REM without Node.js it opens index.html directly, which runs offline on the embedded demo data.
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting Scope on http://localhost:8130 - close this window to stop.
  start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8130/"
  node tools\serve.js 8130
) else (
  echo Node.js not found: opening index.html directly.
  start "" "%~dp0index.html"
)
