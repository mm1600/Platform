@echo off
rem Scope: double-click once to put a "Scope" shortcut (green S icon) on your desktop and in the Start menu.
rem Then right-click the shortcut and choose "Pin to taskbar". Nothing is installed: Scope runs from this folder,
rem so updating the files here updates everyone. Tries PowerShell first (launcher\create-shortcut.ps1, which writes
rem launcher\last-run.log), then the script host (launcher\create-shortcut.vbs) when PowerShell is blocked.
setlocal
set "HERE=%~dp0"
echo Creating the Scope shortcut from "%HERE%" ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%launcher\create-shortcut.ps1"
if not errorlevel 1 goto done
echo.
echo PowerShell could not do it; trying the Windows script host instead ...
cscript //nologo "%HERE%launcher\create-shortcut.vbs"
if not errorlevel 1 goto done
echo.
echo The shortcut could not be created automatically. launcher\README.txt explains how to make it by hand,
echo and launcher\last-run.log holds the details of what went wrong.
:done
echo.
pause
