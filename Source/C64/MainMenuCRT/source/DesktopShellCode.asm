; Build the main menu as the standalone desktop payload.
; MainMenu.asm owns the load address and all shared source includes.
!set DesktopShell=1
!src "source/MainMenu.asm"
