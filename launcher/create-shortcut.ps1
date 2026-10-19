# Scope: creates the "Scope" shortcut (green S icon) on the desktop and in the Start menu.
#
# Run it through "Create Scope shortcut.bat" in the Scope folder. The shortcut opens index.html from that folder in its
# own Microsoft Edge window (app mode: no tabs, no address bar), so Scope looks and pins like an app. Nothing is
# installed: Scope keeps running from its folder (e.g. a shared drive), so replacing the files there updates everyone.
# Only the icon is copied to %LOCALAPPDATA%\Scope, so the taskbar icon still shows when the share is slow or offline.
# Every step is written to launcher\last-run.log, so a failure can be read (or photographed) afterwards.
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'last-run.log'
function Say([string]$m) { Write-Host $m; try { Add-Content -LiteralPath $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {} }
try { Set-Content -LiteralPath $log -Value '' } catch {}
try {
  Say "PowerShell $($PSVersionTable.PSVersion) - script folder: $PSScriptRoot"
  # the Scope folder (this file is in Scope\launcher)
  $root = Split-Path -Parent $PSScriptRoot
  # a mapped drive letter (S:\...) can differ from person to person: use the network path (\\server\share\...) when there is one
  try {
    if ($root -match '^([A-Za-z]):') {
      $drive = Get-PSDrive -Name $Matches[1] -ErrorAction SilentlyContinue
      if ($drive -and $drive.DisplayRoot -and $drive.DisplayRoot.StartsWith('\\')) { $root = $drive.DisplayRoot.TrimEnd('\') + $root.Substring(2) }
    }
  } catch { Say "note: could not resolve a network path for the drive letter ($($_.Exception.Message)); the letter is kept" }
  $page = Join-Path $root 'index.html'
  if (-not (Test-Path -LiteralPath $page)) { throw "index.html was not found in $root" }
  $url = ([System.Uri]$page).AbsoluteUri   # file://server/share/Scope/index.html (spaces encoded)
  Say "Scope folder: $root"
  Say "page: $url"

  # the icon, kept locally (falls back to the one in the share if the copy is not allowed)
  $icon = Join-Path $PSScriptRoot 'Scope.ico'
  try {
    $iconDir = Join-Path $env:LOCALAPPDATA 'Scope'
    New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Scope.ico') -Destination (Join-Path $iconDir 'Scope.ico') -Force
    $icon = Join-Path $iconDir 'Scope.ico'
  } catch { Say "note: icon not copied locally ($($_.Exception.Message)); the icon in the Scope folder is used" }
  Say "icon: $icon"

  # Microsoft Edge (on every Windows 10/11 PC); without it the shortcut opens the page in the default browser
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  Say ("Edge: " + $(if ($edge) { $edge } else { 'not found (default browser will be used)' }))

  $shell = New-Object -ComObject WScript.Shell
  $made = @()
  foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    if (-not $dir) { continue }
    try {
      $lnkPath = Join-Path $dir 'Scope.lnk'
      $lnk = $shell.CreateShortcut($lnkPath)
      if ($edge) { $lnk.TargetPath = $edge; $lnk.Arguments = "--app=`"$url`""; $lnk.WorkingDirectory = Split-Path -Parent $edge }
      else { $lnk.TargetPath = $page; $lnk.WorkingDirectory = $root }
      $lnk.IconLocation = "$icon,0"
      $lnk.Description = 'Scope: infrastructure debt platform'
      $lnk.Save()
      $made += $lnkPath
      Say "created: $lnkPath"
    } catch { Say "could not create a shortcut in $dir ($($_.Exception.Message))" }
  }
  if (-not $made.Count) { throw 'no shortcut could be created (see the messages above)' }

  Write-Host ''
  Write-Host 'Scope shortcut created:'
  $made | ForEach-Object { Write-Host "  $_" }
  Write-Host "It opens: $url"
  if ($edge) { Write-Host 'To pin it: right-click the Scope shortcut on your desktop and choose "Pin to taskbar" (Windows 11: Show more options > Pin to taskbar).' }
  else { Write-Host 'Microsoft Edge was not found, so Scope opens in your default browser (this shortcut cannot be pinned to the taskbar).' }
  exit 0
} catch {
  Say ("FAILED: " + $_.Exception.Message)
  Write-Host ''
  Write-Host "The shortcut could not be created: $($_.Exception.Message)"
  Write-Host "Details are in $log. launcher\README.txt explains how to make the shortcut by hand (two minutes)."
  exit 1
}
