; NeoXten — NSIS hooks for Tauri bundler (local Operator service cleanup on uninstall).
; Install directory must NOT be %LOCALAPPDATA%\NeoXten (that path is product data only).
; Use a distinct productName in tauri.conf.json (e.g. "NeoXten Desktop") so $INSTDIR does not collide.

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop desktop shell if still running (Cargo binary name).
  nsExec::ExecToLog 'cmd.exe /C taskkill /F /IM neoxten-factory.exe /T'
  ; Stale Control API lock prevents clean restart after reinstall.
  ReadEnvStr $0 LOCALAPPDATA
  IfFileExists "$0\NeoXten\operator\service-lock.json" 0 +2
    Delete "$0\NeoXten\operator\service-lock.json"
!macroend
