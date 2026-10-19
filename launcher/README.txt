Scope as an app on Windows (icon, Start menu, taskbar)
======================================================

The easy way
  1. Open the Scope folder (for example on the shared drive).
  2. Double-click "Create Scope shortcut.bat".
     A "Scope" shortcut with the green S icon appears on your desktop and in the Start menu.
  3. Right-click the shortcut and choose "Pin to taskbar"
     (Windows 11: right-click > Show more options > Pin to taskbar).

Clicking it opens Scope in its own window (Microsoft Edge in app mode: no tabs, no address bar).
Nothing is installed. Scope runs from its folder, so when the files there are replaced, everyone
gets the new version the next time they open it. Each person's loaded workbook and settings stay
in their own browser on their own PC.

By hand (if your PC blocks the .bat file)
  1. Right-click the desktop > New > Shortcut.
  2. For the location, paste (with the real path of the Scope folder):
       "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="file://SERVER/SHARE/Scope/index.html"
     A folder on a drive letter is written file:///S:/Folder/Scope/index.html instead.
  3. Name it Scope and click Finish.
  4. Right-click the shortcut > Properties > Change Icon > Browse > pick launcher\Scope.ico in the Scope folder.
  5. Right-click the shortcut > Pin to taskbar.

Files here
  Scope.ico             the icon (green, white S)
  create-shortcut.ps1   what "Create Scope shortcut.bat" runs

If the .bat does nothing or closes at once
  - Open it from the Scope folder itself (not from a zip preview window: unzip first).
  - launcher\last-run.log says what happened; send that if it still fails.
  - PowerShell may be blocked by policy: the .bat then tries launcher\create-shortcut.vbs (the Windows script host).
  - Running Edge in app mode may also be blocked by policy; then make a plain shortcut to index.html (steps above).
