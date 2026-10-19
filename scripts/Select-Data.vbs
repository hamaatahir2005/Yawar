Option Explicit
Dim fs, sh, dialog, chosen, directory, home, stream, config, answer
Set fs = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
Set dialog = CreateObject("Shell.Application")
Set chosen = dialog.BrowseForFolder(0, "Select the EXISTING clinic data folder containing clinic.sqlite. Close all clinic windows first.", 0, 0)
If chosen Is Nothing Then WScript.Quit 0
On Error Resume Next
directory = chosen.Self.Path
On Error GoTo 0
If directory = "" Then WScript.Quit 1
If Not fs.FileExists(fs.BuildPath(directory, "clinic.sqlite")) Then
    MsgBox "This folder does not contain clinic.sqlite. Nothing was changed.", 16, "Yawar Clinic"
    WScript.Quit 1
End If
answer = MsgBox("Use this existing database folder?" & vbCrLf & directory & vbCrLf & "No files will be copied or deleted.", 4 + 32, "Yawar Clinic")
If answer <> 6 Then WScript.Quit 0
home = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\YawarClinic"
If Not fs.FolderExists(home) Then fs.CreateFolder home
config = "{""dataDirectory"":""" & Replace(Replace(directory, "\", "\\"), Chr(34), "\" & Chr(34)) & """}"
Set stream = CreateObject("ADODB.Stream")
stream.Type = 2
stream.Charset = "utf-8"
stream.Open
stream.WriteText config
stream.SaveToFile home & "\desktop-config.json", 2
stream.Close
MsgBox "Existing clinic data selected. Open the Yawar desktop icon. The selected folder must remain available.", 64, "Yawar Clinic"
