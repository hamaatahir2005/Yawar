Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!ifndef STAGE
  !error "Pass /DSTAGE=path-to-verified-Windows-bundle"
!endif
!ifndef OUTPUT
  !define OUTPUT "Yawar-Setup.exe"
!endif
Name "Yawar Dental Clinic"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\YawarClinic"
InstallDirRegKey HKCU "Software\YawarClinic" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${STAGE}\deploy\assets\clinic.ico"
!define MUI_UNICON "${STAGE}\deploy\assets\clinic.ico"
!define MUI_WELCOMEPAGE_TEXT "Install Yawar Dental Clinic for offline use on this Windows computer.$\r$\n$\r$\nClose any existing Yawar server window before continuing. Existing clinic data is kept separately and is not deleted by uninstalling.$\r$\n$\r$\nMicrosoft Edge or Google Chrome is required for the application window."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Yawar Dental Clinic"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchYawar
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Yawar requires 64-bit Windows and a supported Microsoft Edge or Chrome installation."
    Abort
  ${EndIf}
FunctionEnd
Section "Yawar Clinic" SEC_MAIN
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 File /r "${STAGE}\*"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Yawar Clinic"
 CreateShortCut "$DESKTOP\Yawar Clinic.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\scripts\Desktop.vbs"' "$INSTDIR\deploy\assets\clinic.ico"
 CreateShortCut "$SMPROGRAMS\Yawar Clinic\Yawar Clinic.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\scripts\Desktop.vbs"' "$INSTDIR\deploy\assets\clinic.ico"
 CreateShortCut "$SMPROGRAMS\Yawar Clinic\Choose existing clinic data.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\scripts\Select-Data.vbs"' "$INSTDIR\deploy\assets\clinic.ico"
 CreateShortCut "$SMPROGRAMS\Yawar Clinic\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\YawarClinic" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic" "DisplayName" "Yawar Dental Clinic"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic" "DisplayVersion" "4.0.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic" "DisplayIcon" "$INSTDIR\deploy\assets\clinic.ico"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic" "NoRepair" 1
SectionEnd
Function LaunchYawar
 ExecShell "open" "$SYSDIR\wscript.exe" '"$INSTDIR\scripts\Desktop.vbs"'
FunctionEnd
Section "Uninstall"
 SetShellVarContext current
 Delete "$DESKTOP\Yawar Clinic.lnk"
 Delete "$SMPROGRAMS\Yawar Clinic\Yawar Clinic.lnk"
 Delete "$SMPROGRAMS\Yawar Clinic\Choose existing clinic data.lnk"
 Delete "$SMPROGRAMS\Yawar Clinic\Uninstall.lnk"
 RMDir "$SMPROGRAMS\Yawar Clinic"
 ; Generated file list deletes shipped program files only. Never recurse through
 ; the installation folder: unknown files, clinic databases and backups survive.
 !include "${UNINSTALL_FILES}"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\YawarClinic"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YawarClinic"
SectionEnd
