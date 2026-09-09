; Native RTC utility, streamed into the existing high-RAM app bank.
!convtab pet
!src "build/DesktopSymbols"
* = $c000
!src "source/GeosAppABI.s"
!src "source/GeosClock.s"
!src "source/GeosAppHelpers.s"
GeosUtilityEnd:
!if GeosUtilityEnd > $d000 {
   !error "Desktop clock exceeds reserved $c000-$cfff RAM"
}
