; Included through tools/build-installer.cjs, which generates an exact file list.
; Never stop CloudMusic or remove its files/profile. No automatic launch/logon item.
!ifndef MINERADIO_REMOVE_LIST
  !error "Use tools/build-installer.cjs so uninstall has an explicit owned-file list."
!endif

!macro MINERADIO_VALIDATE_INSTALL_DIR
  ; Called from the official CHECK_APP_RUNNING hook inside installSection,
  ; after the directory page's final sanitization and before any old uninstall
  ; or package extraction. It also applies to /S and /D command-line installs.
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $R6 "0"
  ${If} $INSTDIR == ""
    StrCpy $R6 "1"
  ${Else}
    GetFullPathName $R2 "$INSTDIR"
    ${GetRoot} "$R2" $R3
    ${If} $R2 == "$R3\"
    ${OrIf} $R2 == $R3
    ${OrIf} $R2 == $PROFILE
    ${OrIf} $R2 == $WINDIR
    ${OrIf} $R2 == $SYSDIR
    ${OrIf} $R2 == $LOCALAPPDATA
    ${OrIf} $R2 == $APPDATA
    ${OrIf} $R2 == $DESKTOP
    ${OrIf} ${FileExists} "$R2\cloudmusic.exe"
      StrCpy $R6 "1"
    ${EndIf}
    ${If} $R6 == "0"
      ; Only this AppID's registered upgrade path or its exact receipt permits
      ; installing into a nonempty directory. Unknown app directories are refused.
      ReadRegStr $R3 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $R3 != ""
        GetFullPathName $R3 "$R3"
      ${EndIf}
      ${If} $R3 != $R2
        StrCpy $R3 "0"
        ClearErrors
        FileOpen $R4 "$R2\mineradio-installation.txt" r
        ${IfNot} ${Errors}
          FileRead $R4 $R5
          FileClose $R4
          ${If} $R5 == "Mineradio.DesktopLyrics$\r$\n"
          ${OrIf} $R5 == "Mineradio.DesktopLyrics$\n"
            StrCpy $R3 "1"
          ${EndIf}
        ${EndIf}
        ${If} $R3 != "1"
          ClearErrors
          FindFirst $R4 $R5 "$R2\*"
          ${IfNot} ${Errors}
            ${Do}
              ${If} $R5 != "."
              ${AndIf} $R5 != ".."
              ${AndIf} $R5 != ""
                StrCpy $R6 "1"
                ${ExitDo}
              ${EndIf}
              FindNext $R4 $R5
              ${If} ${Errors}
                ${ExitDo}
              ${EndIf}
            ${Loop}
            FindClose $R4
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $R6 != "0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "此安装位置不是空的新文件夹，也不是已登记的 Mineradio 桌面歌词目录。为保护网易云、其他软件和私人文件，安装已停止。请重新运行安装器，选择新的空文件夹；不要选择网易云、磁盘根目录或旧手工部署的上级目录。"
    Abort
  ${EndIf}
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    !insertmacro MINERADIO_VALIDATE_INSTALL_DIR
  !endif
  ; Fail closed when a lyric process is active. The user exits it from its tray;
  ; the installer must not force-terminate either lyrics or music.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if (Get-Process -Name MineradioLyrics -ErrorAction SilentlyContinue) { exit 42 } else { exit 0 }"'
  Pop $R0
  Pop $R1
  ${If} $R0 == 42
    MessageBox MB_OK|MB_ICONINFORMATION "请先从 Mineradio 托盘退出桌面歌词，再继续安装或卸载。网易云音乐不需要退出。"
    Abort
  ${ElseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认桌面歌词是否仍在运行。请关闭桌面歌词后重试；没有强制结束任何程序。"
    Abort
  ${EndIf}
!macroend

!macro customInstall
  ; This program-specific receipt is not a user preference or plugin profile.
  FileOpen $R0 "$INSTDIR\mineradio-installation.txt" w
  FileWrite $R0 "Mineradio.DesktopLyrics$\r$\n${VERSION}$\r$\nInstalled by the per-user candidate Setup.$\r$\nPreferences: %APPDATA%\MineradioExternalLyrics (retained on uninstall).$\r$\n"
  FileClose $R0
!macroend

!macro customRemoveFiles
  ; Replace electron-builder's default RMDir /r $INSTDIR with exact file deletes.
  ; Unknown files and nonempty directories remain in place, including backups.
  SetOutPath $TEMP
  !include "${MINERADIO_REMOVE_LIST}"
!macroend
