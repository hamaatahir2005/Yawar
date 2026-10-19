Option Explicit
Dim fs, shell, root, node, command
Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
node = fs.BuildPath(root, "runtime\node.exe")
If Not fs.FileExists(node) Then
    MsgBox "The desktop runtime is missing. Reinstall Yawar Setup; patient data is stored separately and will not be deleted.", 16, "Yawar Clinic"
    WScript.Quit 1
End If
shell.CurrentDirectory = root
command = Chr(34) & node & Chr(34) & " " & Chr(34) & fs.BuildPath(root, "scripts\desktop.js") & Chr(34)
shell.Run command, 0, False
