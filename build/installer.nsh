; Extra installer steps for QA-STE100-Studio (included by electron-builder.yml).
;
; A (re)install from the installer starts clean: the app's data folder (settings, environment,
; SSH key, browser login, chats, recordings, tests, knowledge base, framework copy) is removed.
; In-app updates run the installer with --updated and keep everything.
;
; The data folder keeps the app's earlier name, QA-ASD-STE100 (see src/main/index.ts).
;
; An update shows only the "Installing…" progress page: no questions, no Finish page, and the
; app starts again by itself when it is done.

!macro customInstall
  ${ifNot} ${isUpdated}
    ; The data folder belongs to the user who runs the installer, also in an "all users" install.
    SetShellVarContext current
    RMDir /r "$APPDATA\QA-ASD-STE100"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
  ; Shortcuts from before the rename point to a program that no longer exists.
  Delete "$DESKTOP\QA-ASD-STE100.lnk"
  Delete "$SMPROGRAMS\QA-ASD-STE100.lnk"
!macroend

; Uninstalling removes the data folder too (deleteAppDataOnUninstall only knows the new name).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetShellVarContext current
    RMDir /r "$APPDATA\QA-ASD-STE100"
  ${endIf}
!macroend

; An update keeps the existing kind of install ("only for me" or "all users") without asking.
!macro customInstallMode
  ${if} ${isUpdated}
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $0 != ""
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endIf}
  ${endIf}
!macroend

; The Finish page with "Run QA-STE100-Studio" for a new install; an update skips it and starts the app.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function SkipFinishWhenUpdating
    ${if} ${isUpdated}
      Call StartApp
      ; Skipping the last page ends the installer.
      Abort
    ${endIf}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipFinishWhenUpdating
  !insertmacro MUI_PAGE_FINISH
!macroend
