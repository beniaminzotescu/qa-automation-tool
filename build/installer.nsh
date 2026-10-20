; Extra installer steps for QA-ASD-STE100 (included by electron-builder.yml).
;
; A (re)install from the installer starts clean: the app's data folder (settings, environment,
; SSH key, browser login, chats, recordings, tests, knowledge base, framework copy) is removed.
; In-app updates run the installer with --updated and keep everything.

!macro customInstall
  ${ifNot} ${isUpdated}
    ; The data folder belongs to the user who runs the installer, also in an "all users" install.
    SetShellVarContext current
    RMDir /r "$APPDATA\QA-ASD-STE100"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend
