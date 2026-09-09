; Standalone BASIC-loadable wrapper for the enhanced desktop shell.
; The embedded payload is assembled separately at MainCodeRAMStart.

!convtab pet
!set DesktopShell=1
!src "source/CommonDefs.i"

* = $0801

; 10 SYS2061 ($080d)
!word BasicProgramEnd
!word 10
!byte $9e
!text "2061"
!byte 0
BasicProgramEnd:
!word 0

DesktopShellLoader:
   sei
   cld
   ;The settings overlay's source sits inside the upward-moving desktop copy.
   ;Save it under KERNAL ROM first, then install it in low RAM after that copy.
   lda $01
   pha
   and #$fd
   sta $01
   lda #<DesktopSettingsPayload
   sta PtrAddrLo
   lda #>DesktopSettingsPayload
   sta PtrAddrHi
   lda #<DesktopSettingsTemporary
   sta Ptr2AddrLo
   lda #>DesktopSettingsTemporary
   sta Ptr2AddrHi
   lda #<DesktopSettingsPayloadEnd
   sta DesktopCopyEndLo
   lda #>DesktopSettingsPayloadEnd
   sta DesktopCopyEndHi
   jsr DesktopCopyForward
   pla
   sta $01
   ; Copy the app extension before the main payload can overwrite its source.
   lda #<DesktopAppsPayload
   sta PtrAddrLo
   lda #>DesktopAppsPayload
   sta PtrAddrHi
   lda #<GeosAppEntry
   sta Ptr2AddrLo
   lda #>GeosAppEntry
   sta Ptr2AddrHi
   lda #<DesktopAppsPayloadEnd
   sta DesktopCopyEndLo
   lda #>DesktopAppsPayloadEnd
   sta DesktopCopyEndHi
   jsr DesktopCopyForward
   ;The larger payload overlaps its destination. Copy end-to-start so each
   ;source byte is consumed before a higher destination byte replaces it.
   lda #<DesktopShellPayloadEnd
   sta PtrAddrLo
   lda #>DesktopShellPayloadEnd
   sta PtrAddrHi

   lda #<DesktopShellDestinationEnd
   sta Ptr2AddrLo
   lda #>DesktopShellDestinationEnd
   sta Ptr2AddrHi

   ldy #0
CopyDesktopShellByte:
   lda PtrAddrLo
   bne +
   dec PtrAddrHi
+
   dec PtrAddrLo
   lda Ptr2AddrLo
   bne +
   dec Ptr2AddrHi
+
   dec Ptr2AddrLo
   lda (PtrAddrLo),y
   sta (Ptr2AddrLo),y

   lda PtrAddrLo
   cmp #<DesktopShellPayload
   bne CopyDesktopShellByte
   lda PtrAddrHi
   cmp #>DesktopShellPayload
   bne CopyDesktopShellByte

   ;The overlapping desktop move is complete, so low RAM is now safe.
   lda $01
   pha
   and #$fd
   sta $01
   lda #<DesktopSettingsTemporary
   sta PtrAddrLo
   lda #>DesktopSettingsTemporary
   sta PtrAddrHi
   lda #<GeosSettingsBase
   sta Ptr2AddrLo
   lda #>GeosSettingsBase
   sta Ptr2AddrHi
   lda #<(DesktopSettingsTemporary+DesktopSettingsPayloadEnd-DesktopSettingsPayload)
   sta DesktopCopyEndLo
   lda #>(DesktopSettingsTemporary+DesktopSettingsPayloadEnd-DesktopSettingsPayload)
   sta DesktopCopyEndHi
   jsr DesktopCopyForward
   pla
   sta $01
   jmp MainCodeRAMStart

DesktopCopyForward:
   ldy #0
-  lda (PtrAddrLo),y
   sta (Ptr2AddrLo),y
   inc PtrAddrLo
   bne +
   inc PtrAddrHi
+  inc Ptr2AddrLo
   bne +
   inc Ptr2AddrHi
+  lda PtrAddrLo
  cmp DesktopCopyEndLo
   bne -
   lda PtrAddrHi
   cmp DesktopCopyEndHi
   bne -
   rts

DesktopCopyEndLo: !byte 0
DesktopCopyEndHi: !byte 0

DesktopShellPayload:
   !binary "build/DesktopShellCode.bin"
DesktopShellPayloadEnd:
DesktopAppsPayload:
   !binary "build/GeosApps.bin"
DesktopAppsPayloadEnd:
DesktopSettingsPayload:
   !binary "build/GeosSettings.bin"
DesktopSettingsPayloadEnd:
DesktopShellDestinationEnd = MainCodeRAMStart + DesktopShellPayloadEnd - DesktopShellPayload
DesktopSettingsTemporary = $e000

!if DesktopShellPayload > MainCodeRAMStart {
   !error "Desktop shell loader overlaps its copy destination"
}
!if DesktopShellDestinationEnd > $a000 {
   !error "Desktop shell destination exceeds RAM below BASIC ROM"
}
!if DesktopAppsPayloadEnd-DesktopAppsPayload > $1000 {
   !error "Desktop apps exceed reserved high RAM"
}
!if DesktopSettingsPayloadEnd-DesktopSettingsPayload > $1000 {
   !error "Native settings exceed reserved low RAM"
}
