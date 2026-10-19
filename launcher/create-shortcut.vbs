'' Scope: creates the "Scope" shortcut without PowerShell (used by "Create Scope shortcut.bat" when PowerShell is blocked).
'' Same result as launcher\create-shortcut.ps1: a shortcut on the desktop and in the Start menu that opens index.html
'' from this folder in its own Microsoft Edge window, with the Scope icon.
Option Explicit
Dim fso, shell, here, root, page, url, icon, edge, i, dirs, lnk, made
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)   ' Scope\launcher
root = fso.GetParentFolderName(here)                      ' Scope
page = fso.BuildPath(root, "index.html")
If Not fso.FileExists(page) Then
  WScript.Echo "index.html was not found in " & root
  WScript.Quit 1
End If
url = "file:///" & Replace(Replace(page, "\", "/"), " ", "%20")
If Left(page, 2) = "\\" Then url = "file:" & Replace(Replace(page, "\", "/"), " ", "%20")
icon = fso.BuildPath(here, "Scope.ico")
edge = ""
Dim candidates
candidates = Array(shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
                   shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
                   shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\Application\msedge.exe")
For i = 0 To UBound(candidates)
  If edge = "" And fso.FileExists(candidates(i)) Then edge = candidates(i)
Next
dirs = Array(shell.SpecialFolders("Desktop"), shell.SpecialFolders("Programs"))
made = 0
For i = 0 To UBound(dirs)
  On Error Resume Next
  Set lnk = shell.CreateShortcut(fso.BuildPath(dirs(i), "Scope.lnk"))
  If edge <> "" Then
    lnk.TargetPath = edge
    lnk.Arguments = "--app=""" & url & """"
    lnk.WorkingDirectory = fso.GetParentFolderName(edge)
  Else
    lnk.TargetPath = page
    lnk.WorkingDirectory = root
  End If
  lnk.IconLocation = icon & ",0"
  lnk.Description = "Scope: infrastructure debt platform"
  lnk.Save
  If Err.Number = 0 Then
    made = made + 1
    WScript.Echo "created: " & fso.BuildPath(dirs(i), "Scope.lnk")
  Else
    WScript.Echo "could not create a shortcut in " & dirs(i) & " (" & Err.Description & ")"
    Err.Clear
  End If
  On Error GoTo 0
Next
If made = 0 Then WScript.Quit 1
WScript.Echo "It opens: " & url
WScript.Echo "To pin it: right-click the Scope shortcut on your desktop and choose ""Pin to taskbar""."
WScript.Quit 0
