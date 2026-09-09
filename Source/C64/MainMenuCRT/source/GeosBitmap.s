; True 320x200 standard high-resolution bitmap renderer for DesktopShell.
;
; The layout routines compose text and icons in a protected off-screen canvas.
; The displayed bitmap at $2000 remains visible while changed glyph bytes and
; their two-color pairs at $0400 are applied. Colors are staged in the consumed
; layout at $4000 and published only after the new bitmap. No text-mode pass.
; Bit 4 of $d016 stays clear: this is 320-pixel standard hi-res, not 160-pixel
; multicolor mode.

   GeosBitmapRAM = $2000
   GeosBitmapRAMEnd = $3f40
   GeosBitmapScreen = C64ScreenRAM

   ;Screen-byte nibbles are foreground/background in standard bitmap mode.
   GeosBitmapColorNormal = $01     ;black on white
   GeosBitmapColorAccent = $61     ;blue on white
   GeosBitmapColorSelected = $16   ;white on blue
   GeosBitmapColorClock = $76      ;yellow on blue
   GeosBitmapColorStatus = $0f     ;black on light grey

; Apply the complete off-screen character surface to the real VIC-II bitmap.
GeosBitmapConvertScreen:
   jsr GeosRichBegin
   ;A new page/surface already rebuilds every label; discard the live cache.
   lda #$ff
   sta GeosBitmapSelectedItem
   lda #>(GeosLayoutScreen-C64ScreenRAM)
   sta GeosBitmapColorOffset

   ;Keep the VIC in bank 0, where screen $0400 and bitmap $2000 reside.
   lda $dd02
   ora #%00000011
   sta $dd02
   lda $dd00
   ora #%00000011
   sta $dd00

   ;The previous bitmap stays visible while the off-screen layout is applied.
   lda #0
   sta GeosBitmapActive
   ; Home/browser/window contents are now composed directly in the native
   ; bitmap. The obsolete character-grid pass must not redraw stale layout.
GeosBitmapFinishLayout:
   jsr GeosBitmapTintSurface
   jsr GeosRichCompose

   ;$0400 is the screen matrix, $2000 is the bitmap, and multicolor stays off.
   lda #MouseSpritePointerValue
   sta Sprite0Pointer
   lda #$18
   sta VICMemSetup
   lda #$c8
   sta $d016
   lda #PokeBlack
   sta BorderColorReg
   lda #PokeWhite
   sta BackgndColorReg
   lda #$3b
   sta $d011
   lda #0
   sta GeosBitmapLayoutPass
   lda #>C64ScreenRAM
   sta $0288
   lda #1
   sta GeosBitmapActive
   jsr GeosBitmapRefreshBrowserSelection
   jsr GeosBitmapDisplayTime
   rts

; Publish only after GeosRichPublish has installed every new bitmap byte.
; Reusing the consumed layout avoids allocating another 1 KiB of desktop RAM.
GeosBitmapPublishColors:
   ldx #0
GeosBitmapPublishColorLoop:
   !for page,0,2 {
      lda GeosLayoutScreen+page*256,x
      cmp C64ScreenRAM+page*256,x
      beq +
      sta C64ScreenRAM+page*256,x
+
   }
   inx
   bne GeosBitmapPublishColorLoop
   ldx #0
GeosBitmapPublishColorTail:
   lda GeosLayoutScreen+768,x
   cmp C64ScreenRAM+768,x
   beq +
   sta C64ScreenRAM+768,x
+  inx
   cpx #232
   bne GeosBitmapPublishColorTail
   lda #0
   sta GeosBitmapColorOffset
   rts

!ifndef DesktopShell {
; Font installation now writes directly to protected CPU-only font storage.
GeosBitmapCaptureFont:
   rts

; GeosBitmapScreenCode selects one of the captured 8-byte glyphs.
GeosBitmapSetFontPointer:
   lda #0
   sta GeosBitmapFontOffsetHi
   lda GeosBitmapScreenCode
   asl
   rol GeosBitmapFontOffsetHi
   asl
   rol GeosBitmapFontOffsetHi
   asl
   rol GeosBitmapFontOffsetHi
   clc
   adc #<GeosBitmapFontData
   sta PtrAddrLo
   lda GeosBitmapFontOffsetHi
   adc #>GeosBitmapFontData
   sta PtrAddrHi
   rts

; GeosBitmapRow/Col select one 8x8 bitmap cell.
GeosBitmapSetCellPointer:
   ldx GeosBitmapRow
   lda TblGeosBitmapRowLo,x
   sta Ptr2AddrLo
   lda TblGeosBitmapRowHi,x
   sta Ptr2AddrHi
   lda #0
   sta GeosBitmapCellOffsetHi
   lda GeosBitmapCol
   asl
   rol GeosBitmapCellOffsetHi
   asl
   rol GeosBitmapCellOffsetHi
   asl
   rol GeosBitmapCellOffsetHi
   clc
   adc Ptr2AddrLo
   sta Ptr2AddrLo
   lda GeosBitmapCellOffsetHi
   adc Ptr2AddrHi
   sta Ptr2AddrHi
   rts

}

; Give the status strip its own restrained color pair.  Reverse-video menu and
; selection cells retain their blue palette from the conversion loop.
GeosBitmapTintSurface:
   ; Every native surface starts with coherent black/white staged color cells.
   ; Shared windows may change their own region after bitmap composition.
   lda GeosAppearancePrefs
   and #rpud3AppearanceDark
   beq +
   lda #$10                    ;white ink on black
   bne ++
+  lda #GeosBitmapColorNormal ;black ink on white
++ sta GeosBitmapColor
   ldx #0
-  sta GeosLayoutScreen,x
   sta GeosLayoutScreen+256,x
   sta GeosLayoutScreen+512,x
   inx
   bne -
   ldx #232
-  sta GeosLayoutScreen+767,x
   dex
   bne -
   rts

; ---------------------------------------------------------------------------
!ifndef DesktopShell {
; Bitmap-native text primitives used after screen RAM becomes color data.

; X=row, Y=column.
GeosBitmapSetCursor:
   stx GeosBitmapRow
   sty GeosBitmapCol
   rts

; A=PETSCII/control byte.  Rendering never invokes KERNAL CHROUT, so the
; bottom-right cell cannot scroll away the menu bar.
GeosBitmapPutChar:
   cmp #ChrRvsOn
   bne +
   lda #1
   sta GeosBitmapReverse
   rts
+  cmp #ChrRvsOff
   bne +
   lda #0
   sta GeosBitmapReverse
   rts
+  cmp #ChrReturn
   bne GeosBitmapPutPrintable
   lda #0
   sta GeosBitmapCol
   lda GeosBitmapRow
   cmp #24
   bcs GeosBitmapPutReturn
   inc GeosBitmapRow
GeosBitmapPutReturn:
   rts
GeosBitmapPutPrintable:
   jsr GeosBitmapPetsciiToScreen
GeosBitmapPutScreenCode:
   and #$7f
   sta GeosBitmapScreenCode
   php
   sei
   jsr GeosBitmapSetFontPointer
   jsr GeosBitmapSetCellPointer
   ldy #0
GeosBitmapPutGlyphLoop:
   lda (PtrAddrLo),y
   cmp (Ptr2AddrLo),y
   beq +
   sta (Ptr2AddrLo),y
+  iny
   cpy #8
   bne GeosBitmapPutGlyphLoop
   plp

   ldx GeosBitmapRow
   lda TblGeosBitmapScreenRowLo,x
   sta smcGeosBitmapPutColor+1
   lda TblGeosBitmapScreenRowHi,x
   sta smcGeosBitmapPutColor+2
   ldx GeosBitmapCol
   lda GeosBitmapReverse
   beq GeosBitmapUseCurrentColor
   lda #GeosBitmapColorSelected
   bne GeosBitmapStorePutColor
GeosBitmapUseCurrentColor:
   lda GeosBitmapColor
smcGeosBitmapPutColor:
GeosBitmapStorePutColor:
   sta $ffff,x

   inc GeosBitmapCol
   lda GeosBitmapCol
   cmp #40
   bcc +
   lda #0
   sta GeosBitmapCol
   lda GeosBitmapRow
   cmp #24
   bcs +
   inc GeosBitmapRow
+  rts

; Convert PETSCII as the KERNAL screen editor does before indexing the font.
GeosBitmapPetsciiToScreen:
   cmp #$20
   bcs +
   clc
   adc #$80
   rts
+  cmp #$40
   bcs +
   rts
+  cmp #$60
   bcs +
   sec
   sbc #$40
   rts
+  cmp #$80
   bcs +
   sec
   sbc #$20
   rts
+  cmp #$a0
   bcs +
   clc
   adc #$40
   rts
+  cmp #$c0
   bcs +
   sec
   sbc #$40
   rts
+  cmp #$ff
   bne +
   lda #$5e
   rts
+  sec
   sbc #$80
   rts

; A/Y=null-terminated string address.
!ifndef DesktopShell {
GeosBitmapPrintString:
   sta smcGeosBitmapStringRead+1
   sty smcGeosBitmapStringRead+2
GeosBitmapPrintStringLoop:
smcGeosBitmapStringRead:
   lda $ffff
   beq GeosBitmapPrintStringDone
   jsr GeosBitmapPutChar
   inc smcGeosBitmapStringRead+1
   bne GeosBitmapPrintStringLoop
   inc smcGeosBitmapStringRead+2
   bne GeosBitmapPrintStringLoop
GeosBitmapPrintStringDone:
   rts

; X=row. Clear all 40 cells without KERNAL scrolling.
GeosBitmapBlankLine:
   ldy #0
   jsr GeosBitmapSetCursor
   lda #40
   sta GeosBitmapCount
GeosBitmapBlankLineLoop:
   lda #ChrSpace
   jsr GeosBitmapPutChar
   dec GeosBitmapCount
   bne GeosBitmapBlankLineLoop
   rts

}

; A=serial-string selector, X=print limit. The remainder is always drained.
!ifndef DesktopShell {
GeosBitmapPrintSerialLimited:
   sta rwRegSerialString+IO1Port
   stx GeosBitmapCount
GeosBitmapSerialLoop:
   lda rwRegSerialString+IO1Port
   beq GeosBitmapSerialDone
   jsr GeosBitmapPutChar
   dec GeosBitmapCount
   bne GeosBitmapSerialLoop
GeosBitmapSerialDrain:
   lda rwRegSerialString+IO1Port
   bne GeosBitmapSerialDrain
GeosBitmapSerialDone:
   rts

}

}

; Existing Teensy WAIT helpers print through the KERNAL.  If a command starts
; directly from the bitmap desktop, give those transient messages a valid text
; screen; every shell caller redraws the desktop or launches another program
; after the WAIT completes.
GeosBitmapPrepareLegacyWait:
   lda #0
   sta GeosBitmapLayoutPass
   lda GeosBitmapActive
   beq GeosBitmapLegacyWaitReady
   jsr TextScreenMemColor
   lda #ChrToLower
   jsr SendChar
   lda #ChrClear
   jsr SendChar
GeosBitmapLegacyWaitReady:
   rts

; Bitmap waits use plain native text, never MsgWaiting's KERNAL color escapes.
; The repeating fill means activity only: the backend supplies no byte total.
UiWaitPoll = $c013
UiWaitCancelable = $c014
GeosBitmapWait:
   jsr GeosBitmapWaitBegin
GeosBitmapWaitPoll:
   jsr GeosBitmapWaitAnimate
   jsr UiWaitPoll
   bcc GeosBitmapWaitDone
   lda rwRegStatus+IO1Port
   cmp #rsC64Message
   beq GeosBitmapWaitStable
   cmp #rsReady
   bne GeosBitmapWaitPoll
GeosBitmapWaitStable:
   ldx #5
-  cmp rwRegStatus+IO1Port
   bne GeosBitmapWaitPoll
   dex
   bne -
   cmp #rsReady
   beq GeosBitmapWaitDone
   jsr GeosBitmapWaitMessage
   lda #rsContinue
   sta rwRegStatus+IO1Port
   jmp GeosBitmapWaitPoll
GeosBitmapWaitDone:
   rts

; Native drawing uses private absolute/SMC state; IRQwedge restores $01 and
; never touches that state. Keep SID playback and mouse sampling live while
; drawing/publishing. Compact glyph copies retain their own ZP protection.
; Shared loading/status dialogs keep the ready/message handshake above intact.
GeosBitmapWaitBegin:
   lda #2
   jsr GeosDialogOpen
   lda #10
   sta GeosBitmapWaitCol
   lda #0
   sta GeosBitmapWaitPhase
   lda TODTenthSecBCD
   sta GeosBitmapWaitTick
   lda #<MsgGeosLoading
   ldy #>MsgGeosLoading
   jsr GeosDialogBegin
   jsr GeosBitmapWaitBar
   jmp GeosDialogPublish

; CIA tenths keep animation alive even while a binary launch has disabled IRQs.
GeosBitmapWaitAnimate:
   lda TODTenthSecBCD
   cmp GeosBitmapWaitTick
   beq GeosBitmapWaitAnimationDone
   sta GeosBitmapWaitTick
   inc GeosBitmapWaitPhase
   lda GeosBitmapWaitPhase
   cmp #29
   bcc +
   lda #0
   sta GeosBitmapWaitPhase
   dec GeosBitmapWaitCol
+  jsr GeosRichBegin
   jsr GeosBitmapWaitBar
   ; Only the seven-pixel activity strip changed; the frame/body are already
   ; visible. Publish its exact pixels and touched color cells, not the modal.
   lda #<GeosDialogTrackRect
   ldy #>GeosDialogTrackRect
   jsr UiLoadRect
   jsr UiPublishRect
   jmp GeosDialogRestoreBank
GeosBitmapWaitBar:
   lda #<GeosDialogTrackRect
   ldy #>GeosDialogTrackRect
   jsr UiLoadRect
   jsr UiFrame
   lda #33
   sta RichX
   lda #0
   sta RichXHi
   sta RichWHi
   lda #134
   sta RichY
   lda GeosBitmapWaitPhase
   asl
   asl
   asl
   clc
   adc GeosBitmapWaitPhase
   adc #2
   sta RichW
   lda #3
   sta RichH
   lda #$ff
   sta RichInk
   jsr RichRect
   rts
GeosBitmapWaitPublishDone:
   jmp GeosDialogPublish
GeosBitmapWaitAnimationDone:
   rts

; Preserve the latest backend message when replacing busy chrome with an error.
GeosBitmapWaitError:
   lda #0
   ldx #<MsgGeosLoadStopped
   ldy #>MsgGeosLoadStopped
GeosBitmapWaitFinished:
   stx GeosBitmapWaitHeading+1
   sty GeosBitmapWaitHeadingHi+1
   jsr GeosDialogOpen
   jsr GeosRichBegin
   lda #<GeosDialogHeadingRect
   ldy #>GeosDialogHeadingRect
   jsr UiLoadRect
   lda #0
   sta RichInk
   jsr RichRect
   lda #32
   sta RichX
   lda #46
   sta RichY
   lda #$ff
   sta RichInk
GeosBitmapWaitHeading:
   lda #0
GeosBitmapWaitHeadingHi:
   ldy #0
   jsr RichText
   lda #<GeosDialogTrackRect
   ldy #>GeosDialogTrackRect
   jsr UiLoadRect
   lda #0
   sta RichInk
   jsr RichRect
   lda #<GeosDialogCloseRect
   ldy #>GeosDialogCloseRect
   jsr UiLoadRect
   jsr UiClose
   jsr GeosDialogButtons
   jmp GeosBitmapWaitPublishDone

; Shared publisher copies exact edge pixels before touched color cells.
GeosBitmapWaitPublish:
   lda #<GeosDialogRect
   ldy #>GeosDialogRect
   jsr UiLoadRect
   jmp UiPublishRect

GeosBitmapWaitMessage:
   jsr GeosRichBegin
   jsr GeosDialogBodyReset
   lda #1
   sta GeosDialogTextMode
   lda #rsstSerialStringBuf
   jsr GeosDialogSerial
   jmp GeosBitmapWaitPublishDone

; Local notice/error callers retain their own control flow; modal input is
; routed by the shell loop, so ordinary clicks cannot leak to the browser.
GeosBitmapShowMessage:
   pha
   tya
   pha
   lda #0
   jsr GeosDialogOpen
   lda #<MsgGeosInformation
   ldy #>MsgGeosInformation
   jsr GeosDialogBegin
   pla
   tay
   pla
   jmp GeosBitmapWaitLocalBody
GeosBitmapWaitLocalMessage:
   pha
   tya
   pha
   jsr GeosRichBegin
   jsr GeosDialogBodyReset
   pla
   tay
   pla
GeosBitmapWaitLocalBody:
   ldx #1
   stx GeosDialogTextMode
   jsr GeosDialogLocal
   jmp GeosBitmapWaitPublishDone

GeosDialogTrackRect: !byte 31,0,132,2,1,7
GeosDialogHeadingRect: !byte 31,0,45,240,0,10
!convtab raw {
MsgGeosLoading: !tx "Loading",0
MsgGeosLoadStopped: !tx "Operation stopped",0
MsgGeosInformation: !tx "Information",0

}
; Print unsigned A as decimal without leading zeroes.
!ifndef DesktopShell {
GeosBitmapPrintIntByte:
   sta GeosBitmapValue
   lda #0
   sta GeosBitmapDigit
   sta GeosBitmapHundredsPrinted
GeosBitmapHundredsLoop:
   lda GeosBitmapValue
   cmp #100
   bcc GeosBitmapHundredsDone
   sec
   sbc #100
   sta GeosBitmapValue
   inc GeosBitmapDigit
   bne GeosBitmapHundredsLoop
GeosBitmapHundredsDone:
   lda GeosBitmapDigit
   beq GeosBitmapTensStart
   clc
   adc #'0'
   jsr GeosBitmapPutChar
   lda #1
   sta GeosBitmapHundredsPrinted
GeosBitmapTensStart:
   lda #0
   sta GeosBitmapDigit
GeosBitmapTensLoop:
   lda GeosBitmapValue
   cmp #10
   bcc GeosBitmapTensDone
   sec
   sbc #10
   sta GeosBitmapValue
   inc GeosBitmapDigit
   bne GeosBitmapTensLoop
GeosBitmapTensDone:
   lda GeosBitmapDigit
   bne GeosBitmapPrintTens
   lda GeosBitmapHundredsPrinted
   beq GeosBitmapPrintOnes
GeosBitmapPrintTens:
   lda GeosBitmapDigit
   clc
   adc #'0'
   jsr GeosBitmapPutChar
GeosBitmapPrintOnes:
   lda GeosBitmapValue
   clc
   adc #'0'
   jsr GeosBitmapPutChar
   rts

}

; ---------------------------------------------------------------------------
; Live browser selection paints only the old/new bounded label rectangles.
GeosBitmapRefreshBrowserSelection:
   lda GeosBitmapActive
   beq GeosBitmapSelectionDone
   lda GeosOverlayMode
   bne GeosBitmapSelectionDone
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   beq GeosBitmapIECSelection
   cmp #GeosSurfaceBrowser
   bne GeosBitmapSelectionDone
   ldx rRegNumItemsOnPage+IO1Port
   lda rwRegCursorItemOnPg+IO1Port
   jmp GeosBitmapSelectionReady
GeosBitmapIECSelection:
   ldx GeosIECCount
   lda GeosIECSelection
GeosBitmapSelectionReady:
   stx GeosBitmapCount
   cmp #DesktopViewportItems
   bcs GeosBitmapSelectionDone
   cmp GeosBitmapCount
   bcs GeosBitmapSelectionDone
   cmp GeosBitmapSelectedItem
   beq GeosBitmapSelectionDone
   sta GeosBitmapNewItem
   jsr GeosRichBegin
   lda #$ea
   sta RichMirrorMode
   lda GeosBitmapSelectedItem
   cmp #DesktopViewportItems
   bcs GeosBitmapSelectCurrent
   sta RichItem
   jsr GeosRichPaintFileLabel
GeosBitmapSelectCurrent:
   lda GeosBitmapNewItem
   sta GeosBitmapSelectedItem
   sta RichItem
   jsr GeosRichPaintFileLabel
   lda #$60
   sta RichMirrorMode
   lda RichSavedBank
   sta $01
GeosBitmapSelectionDone:
   rts

GeosBitmapDrawBrowserStatus:
   jmp GeosBitmapRefreshBrowserSelection

; Retained metadata formatter is not part of the streamlined desktop view.
; Keep its source for the compact-style reference, but do not spend resident
; desktop bytes on an uncalled formatter.
!ifndef DesktopShell {
GeosBitmapLegacyMetadata:
   ldx #20
   ldy #0
   jsr GeosBitmapSetCursor
   lda #<MsgGeosType
   ldy #>MsgGeosType
   jsr GeosBitmapPrintString
   lda GeosWorkType
   asl
   asl
   clc
   adc #1
   sta GeosBitmapTypeIndex
   lda #3
   sta GeosBitmapCount
GeosBitmapTypeLoop:
   ldy GeosBitmapTypeIndex
   lda TblItemType,y
   jsr GeosBitmapPutChar
   inc GeosBitmapTypeIndex
   dec GeosBitmapCount
   bne GeosBitmapTypeLoop

   lda GeosWorkFlags
   bpl +
   lda #<MsgGeosHandler
   ldy #>MsgGeosHandler
   jsr GeosBitmapPrintString
+  lda #<MsgGeosItem
   ldy #>MsgGeosItem
   jsr GeosBitmapPrintString
   lda rwRegCursorItemOnPg+IO1Port
   clc
   adc #1
   jsr GeosBitmapPrintIntByte
   lda #'/'
   jsr GeosBitmapPutChar
   lda rRegNumItemsOnPage+IO1Port
   jsr GeosBitmapPrintIntByte
   lda #<MsgGeosPageStatus
   ldy #>MsgGeosPageStatus
   jsr GeosBitmapPrintString
   lda rwRegPageNumber+IO1Port
   jsr GeosBitmapPrintIntByte
   lda #'/'
   jsr GeosBitmapPutChar
   lda rRegNumPages+IO1Port
   jsr GeosBitmapPrintIntByte
   rts
}

; ---------------------------------------------------------------------------
; Bitmap-native SID transport and live RTC clock.

GeosBitmapDisplayTime:
   jmp GeosRichClock
; Row bases for bitmap bytes and their matching screen color cells.
TblGeosBitmapRowLo:
   !byte <$2000,<$2140,<$2280,<$23c0,<$2500,<$2640,<$2780,<$28c0
   !byte <$2a00,<$2b40,<$2c80,<$2dc0,<$2f00,<$3040,<$3180,<$32c0
   !byte <$3400,<$3540,<$3680,<$37c0,<$3900,<$3a40,<$3b80,<$3cc0,<$3e00
TblGeosBitmapRowHi:
   !byte >$2000,>$2140,>$2280,>$23c0,>$2500,>$2640,>$2780,>$28c0
   !byte >$2a00,>$2b40,>$2c80,>$2dc0,>$2f00,>$3040,>$3180,>$32c0
   !byte >$3400,>$3540,>$3680,>$37c0,>$3900,>$3a40,>$3b80,>$3cc0,>$3e00
TblGeosBitmapScreenRowLo:
   !byte <$0400,<$0428,<$0450,<$0478,<$04a0,<$04c8,<$04f0,<$0518
   !byte <$0540,<$0568,<$0590,<$05b8,<$05e0,<$0608,<$0630,<$0658
   !byte <$0680,<$06a8,<$06d0,<$06f8,<$0720,<$0748,<$0770,<$0798,<$07c0
TblGeosBitmapScreenRowHi:
   !byte >$0400,>$0428,>$0450,>$0478,>$04a0,>$04c8,>$04f0,>$0518
   !byte >$0540,>$0568,>$0590,>$05b8,>$05e0,>$0608,>$0630,>$0658
   !byte >$0680,>$06a8,>$06d0,>$06f8,>$0720,>$0748,>$0770,>$0798,>$07c0

GeosBitmapActive:           !byte 0
GeosBitmapLayoutPass:       !byte 0
GeosBitmapColorOffset:      !byte 0
GeosBitmapRow:              !byte 0
GeosBitmapCol:              !byte 0
GeosBitmapChar:             !byte 0
GeosBitmapScreenCode:       !byte 0
GeosBitmapFontOffsetHi:     !byte 0
GeosBitmapCellOffsetHi:     !byte 0
GeosBitmapColor:            !byte GeosBitmapColorNormal
GeosBitmapReverse:          !byte 0
GeosBitmapCount:            !byte 0
GeosBitmapValue:            !byte 0
GeosBitmapDigit:            !byte 0
GeosBitmapHundredsPrinted:  !byte 0
GeosBitmapItem:             !byte 0
GeosBitmapSelectedItem:     !byte $ff
GeosBitmapNewItem:          !byte 0
GeosBitmapTypeIndex:        !byte 0
GeosBitmapWaitCol:          !byte 0
GeosBitmapWaitPhase:        !byte 0
GeosBitmapWaitTick:         !byte 0

; Reverse video uses a color pair, not a second inverted font. Reuse that 1 KiB
; for a page-aligned layout canvas, all inside the SID-protected payload.
GeosBitmapFontData = $4400
