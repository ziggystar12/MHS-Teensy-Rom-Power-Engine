; Resident desktop helpers. Production keeps only the fixed ABI and shared
; services in $c000-$cfff; each utility is streamed into this bank on demand.
!convtab pet
!ifdef PreviewApps {
   !src "build/vice-preview/DesktopSymbols"
} else {
   !src "build/DesktopSymbols"
}

* = $c000
!src "source/GeosAppABI.s"

!ifdef PreviewApps {
   ; The UI-only VICE preview has no Teensy stream service. Its development
   ; payload retains all three apps so keys 6-8 still exercise the real UI.
   !src "source/GeosAppRuntimeAll.s"
   !src "source/GeosAppSnake.s"
   !src "source/GeosAppCalculator.s"
   !src "source/GeosAppText.s"
}
!ifndef PreviewApps {
AppEnter:
   lda #1
   rts
}

!src "source/GeosAppHelpers.s"

GeosAppsEnd:
!if GeosAppsEnd > $d000 {
   !error "Desktop helpers exceed reserved $c000-$cfff RAM"
}
