; Native control panel and settings overlay. The desktop loader installs this
; below the VIC-II bitmap, where it remains callable while the desktop, canvas
; and high-RAM app extension keep their existing reservations.
!convtab pet
!set DesktopShell=1
!ifdef PreviewApps {
   !src "build/vice-preview/DesktopSymbols"
}
!ifndef PreviewApps {
   !src "build/DesktopSymbols"
}

* = GeosSettingsBase
   jmp GeosSettingsOpen
   jmp GeosControlDraw
   jmp GeosControlHitTest
   jmp GeosControlItemUp
   jmp GeosControlItemDown
   jmp GeosControlItemLeft
   jmp GeosControlItemRight
   jmp GeosControlSetSelection
   jmp GeosControlHandleKey
   jmp GeosMusicActivate
   jmp GeosMusicOpen
   jmp GeosControlOrigin

!if * <> GeosSettingsCode {
   !error "Native settings ABI vectors changed"
}

!src "source/GeosControl.s"
!src "source/GeosSettings.s"

GeosSettingsEnd:
!if GeosSettingsEnd > $2000 {
   !error "Native settings exceed reserved $1000-$1fff RAM"
}
