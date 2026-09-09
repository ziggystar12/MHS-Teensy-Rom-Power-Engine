; GEOS-inspired desktop layout shared by the compact character-mode recovery
; menu and the expanded 320x200 standard high-resolution bitmap shell.
;
; The compact cartridge uses a RAM character set. DesktopShell composes the
; layout off screen, then applies it to the VIC-II bitmap without displaying
; or clearing a temporary character screen.

   GeosCellWidth = 8
   GeosCellHeight = 4
   GeosGridTop = 3
!ifdef DesktopShell {
   GeosGridColumns = 4
   GeosGridRows = 5
   GeosPageCapacity = DesktopViewportItems
   ;CPU-only layout/font storage. Never overwrite the displayed bitmap.
   GeosCharsetRAM = GeosBitmapFontData
   GeosLayoutScreen = $4000
}
!ifndef DesktopShell {
   GeosGridColumns = 5
   GeosGridRows = 4
   GeosPageCapacity = MaxItemsPerPage
   GeosCharsetRAM = $3800
   GeosLayoutScreen = C64ScreenRAM
}
   GeosIconFirst = $60
   GeosIconFolder = GeosIconFirst
   GeosIconDisk = GeosIconFolder+6
   GeosIconDocument = GeosIconDisk+6
   GeosIconProgram = GeosIconDocument+6

; Non-zero selects the icon desktop.  Upper-case V toggles this byte and the
; classic renderer remains available as a hardware recovery path.
GeosViewMode:
   !byte 1

; Draw the complete desktop.  The Teensy-side directory/page state and all
; launch operations remain untouched; this routine only asks for each item's
; existing name/type metadata.
GeosDrawDesktop:
!ifdef DesktopShell {
   lda #0
   sta GeosBitmapActive
   lda #1
   sta GeosBitmapLayoutPass
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jmp GeosIECDraw
+  lda GeosSurfaceMode
   bne +
   jsr GeosShellDrawHome
   jmp GeosBitmapConvertScreen
+
}
   jsr TextScreenMemColor
   lda #ChrToLower
   jsr SendChar
   lda #ChrClear
   jsr SendChar
   jsr GeosInstallMonoCharset

   jsr GeosDrawHeader
   jsr GeosDrawFooter

   lda rwRegCursorItemOnPg+IO1Port
   cmp rRegNumItemsOnPage+IO1Port
   bcc GeosCursorInRange
   lda #0
   sta rwRegCursorItemOnPg+IO1Port
GeosCursorInRange:

   lda #0
   sta GeosWorkItem
GeosDrawItemLoop:
   lda GeosWorkItem
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosItemsDone
   sta rwRegSelItemOnPage+IO1Port
   jsr GeosDrawOneItem
   inc GeosWorkItem
   jmp GeosDrawItemLoop

GeosItemsDone:
   jsr GeosDrawStatus
!ifdef DesktopShell {
   jsr GeosShellDrawOverlay
   jmp GeosBitmapConvertScreen
}
   rts

; Only the compact recovery menu needs a RAM character font. The desktop
; draws native font and icon assets directly and never reads the old cache.
GeosInstallMonoCharset:
!ifdef DesktopShell { rts }
!ifndef DesktopShell {
   php
   sei
   lda $01
   pha
   lda #$33                    ;character ROM visible to the CPU
   sta $01
   ldx #0
GeosCopyCharset:
   lda $d800,x
   sta GeosCharsetRAM+$000,x
   lda $d900,x
   sta GeosCharsetRAM+$100,x
   lda $da00,x
   sta GeosCharsetRAM+$200,x
   lda $db00,x
   sta GeosCharsetRAM+$300,x
!ifndef DesktopShell {
   lda $dc00,x
   sta GeosCharsetRAM+$400,x
   lda $dd00,x
   sta GeosCharsetRAM+$500,x
   lda $de00,x
   sta GeosCharsetRAM+$600,x
   lda $df00,x
   sta GeosCharsetRAM+$700,x
}
   inx
   bne GeosCopyCharset
   pla
   sta $01

   ldx #0
GeosCopyIconGlyphs:
!ifndef DesktopShell {
   lda GeosIconData,x
}
   sta GeosCharsetRAM+GeosIconFirst*8,x
   inx
!ifndef DesktopShell {
   cpx #GeosIconDataEnd-GeosIconData
}
   bne GeosCopyIconGlyphs


!ifndef DesktopShell {
   lda #$1f                    ;screen $0400, charset $3800
   sta VICMemSetup
   lda #PokeWhite
   sta BorderColorReg
   sta BackgndColorReg
}
   lda #PokeBlack
   sta $0286
   ldx #0
GeosClearColors:
   sta C64ColorRAM+$000,x
   sta C64ColorRAM+$100,x
   sta C64ColorRAM+$200,x
   sta C64ColorRAM+$300,x
   inx
   bne GeosClearColors
   plp
   rts
}

GeosDrawHeader:
!ifdef DesktopShell {
   jmp GeosShellDrawBrowserHeader
}
!ifndef DesktopShell {
   ldx #0
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosTitleBar
   ldy #>MsgGeosTitleBar
   jsr PrintString

   ldx #1
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosSource
   ldy #>MsgGeosSource
   jsr PrintString
   lda rWRegCurrMenuWAIT+IO1Port
   asl
   tax
   lda TblMsgMenuName,x
   ldy TblMsgMenuName+1,x
   jsr PrintString

   ldx #1
   ldy #18
   clc
   jsr SetCursor
   lda #<MsgGeosPage
   ldy #>MsgGeosPage
   jsr PrintString
   lda rwRegPageNumber+IO1Port
   jsr PrintIntByte
   lda #'/'
   jsr SendChar
   lda rRegNumPages+IO1Port
   jsr PrintIntByte

   ldx #2
   ldy #0
   clc
   jsr SetCursor
   lda #<MsgGeosPath
   ldy #>MsgGeosPath
   jsr PrintString
   lda #rsstShortDirPath
   ldx #33
   jsr GeosPrintSerialLimited

   rts
}

GeosDrawFooter:
!ifdef DesktopShell {
   jmp GeosShellDrawBrowserFooter
}
!ifndef DesktopShell {
   ldx #22
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosFooter1
   ldy #>MsgGeosFooter1
   jsr PrintString

   ldx #23
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosFooter2
   ldy #>MsgGeosFooter2
   jsr PrintString

   ldx #24
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosFooter3
   ldy #>MsgGeosFooter3
   jsr PrintString
   rts
}

GeosDrawOneItem:
   lda rRegItemTypePlusIOH+IO1Port
   sta GeosWorkFlags
   and #$7f
   sta GeosWorkType

   lda GeosWorkType
   cmp #rtDirectory
   beq GeosDrawFolderIcon
   cmp #rtD64
   beq GeosDrawDiskIcon
   cmp #rtD71
   beq GeosDrawDiskIcon
   cmp #rtD81
   beq GeosDrawDiskIcon
   cmp #rtFilePrg
   beq GeosDrawProgramIcon
   cmp #rtFileCrt
   beq GeosDrawProgramIcon
   cmp #rtFileP00
   beq GeosDrawProgramIcon
   cmp #rtFileDesktopApp
   beq GeosDrawProgramIcon
   cmp #rtFileVM
   beq GeosDrawProgramIcon
   cmp #rtBin16k
   bcc GeosDrawFileIcon
   cmp #rtBinC128+1
   bcc GeosDrawProgramIcon

GeosDrawFileIcon:
   lda #GeosIconDocument
   bne GeosDrawIcon

GeosDrawFolderIcon:
   lda #GeosIconFolder
   bne GeosDrawIcon

GeosDrawDiskIcon:
   lda #GeosIconDisk
   bne GeosDrawIcon

GeosDrawProgramIcon:
   lda #GeosIconProgram

GeosDrawIcon:
   jsr GeosPutIcon

GeosDrawItemLabel:
!ifndef DesktopShell {
   lda GeosWorkItem
   jsr GeosSetCellLabel
   lda #PokeBlack
   sta $0286
}
!ifdef DesktopShell {
   lda GeosWorkItem
   jsr GeosRichLabelStart
   jsr GeosRichPrintFileLabel
}
!ifndef DesktopShell {
   lda #rsstItemName
   ldx #7
   jsr GeosPrintSerialLimited
}
   rts

!ifdef DesktopShell {
; Capture the two-line bitmap label without spilling into the legacy
; eight-cell layout. All source bytes are consumed, including long filenames.
GeosRichPrintFileLabel:
   lda #rsstDesktopLabel
   sta rwRegSerialString+IO1Port
GeosRichReadFileLabel:
   lda rwRegSerialString+IO1Port
   beq GeosRichFileLabelDone
   jsr GeosRichLabelPut
   jmp GeosRichReadFileLabel
GeosRichFileLabelDone:
   rts

   GeosRichFileLabelCount = GeosPageCapacity
   GeosRichFileLabelLength = DesktopLabelLength
   GeosRichFileLabelStride = DesktopLabelLength+1

; A=item (0..19). Select and clear its twenty PETSCII bytes plus NUL. X/Y/A are
; scratch. Invalid items disable capture instead of writing outside the table.
; Self-modifying absolute pointers do not share zero page with SID playback.
GeosRichLabelStart:
   cmp #GeosRichFileLabelCount
   bcc GeosRichLabelValid
   lda #GeosRichFileLabelLength
   sta GeosRichLabelCount
   rts
GeosRichLabelValid:
   tax
   lda TblGeosRichFileLabelLo,x
   sta GeosRichLabelClear+1
   sta GeosRichLabelStore+1
   lda TblGeosRichFileLabelHi,x
   sta GeosRichLabelClear+2
   sta GeosRichLabelStore+2
   lda #0
   sta GeosRichLabelCount
   ldy #GeosRichFileLabelStride-1
GeosRichLabelClear:
   sta $ffff,y
   dey
   bpl GeosRichLabelClear
   rts

; A=next PETSCII byte. Preserve A/X/Y; cap at twenty, leaving byte twenty as NUL.
GeosRichLabelPut:
   sta GeosRichLabelChar
   tya
   pha
   ldy GeosRichLabelCount
   cpy #GeosRichFileLabelLength
   bcs GeosRichLabelPutDone
   lda GeosRichLabelChar
GeosRichLabelStore:
   sta $ffff,y
   inc GeosRichLabelCount
GeosRichLabelPutDone:
   pla
   tay
   lda GeosRichLabelChar
   rts

GeosRichLabelCount: !byte GeosRichFileLabelLength
GeosRichLabelChar:  !byte 0
; Split pointers include carries for all 460 bytes, independent of placement.
TblGeosRichFileLabelLo: !for i,0,GeosRichFileLabelCount-1 { !byte <(GeosRichFileLabels+i*GeosRichFileLabelStride) }
TblGeosRichFileLabelHi: !for i,0,GeosRichFileLabelCount-1 { !byte >(GeosRichFileLabels+i*GeosRichFileLabelStride) }
GeosRichFileLabels: !fill GeosRichFileLabelCount*GeosRichFileLabelStride,0
GeosRichFileLabelsEnd:
   !src "source/GeosBrowser.s"
}

; A is the first of six consecutive screen codes forming a centered 3x2 icon.
GeosPutIcon:
!ifdef DesktopShell {
   ldx GeosWorkItem
   sta GeosBrowserIcons,x
   rts
}
!ifndef DesktopShell {
   php
   sei
   sta GeosWorkIcon
   lda GeosWorkItem
   asl
   tax
   clc
   lda TblGeosCellScreen,x
   adc #2
   sta PtrAddrLo
   lda TblGeosCellScreen+1,x
   adc #0
   sta PtrAddrHi

   ldy #0
   lda GeosWorkIcon
   sta (PtrAddrLo),y
   iny
   clc
   adc #1
   sta (PtrAddrLo),y
   iny
   adc #1
   sta (PtrAddrLo),y
   ldy #40
   adc #1
   sta (PtrAddrLo),y
   iny
   adc #1
   sta (PtrAddrLo),y
   iny
   adc #1
   sta (PtrAddrLo),y
   plp
   rts
}

GeosSetCellLabel:
!ifndef DesktopShell {
   tax
   ldy TblGeosCellCol,x
   lda TblGeosCellRow,x
   tax
   inx
   inx
   clc
   jmp SetCursor
}
!ifdef DesktopShell { rts }

; A=serial-string selector, X=maximum printable characters.  Any remainder is
; drained so the Teensy serial-string register is left in its normal state.
!ifndef DesktopShell {
GeosPrintSerialLimited:
   sta rwRegSerialString+IO1Port
   stx GeosWorkCount
GeosPrintLimitedLoop:
   lda rwRegSerialString+IO1Port
   beq GeosPrintLimitedDone
   jsr SendChar
   dec GeosWorkCount
   bne GeosPrintLimitedLoop
GeosDrainSerial:
   lda rwRegSerialString+IO1Port
   bne GeosDrainSerial
GeosPrintLimitedDone:
   rts

}

; Keep backend selection aligned without drawing a full-name status strip.
; The compact recovery view retains its original two metadata lines.
GeosDrawStatus:
!ifdef DesktopShell {
   lda rwRegCursorItemOnPg+IO1Port
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosStatusDone
   sta rwRegSelItemOnPage+IO1Port
}
!ifndef DesktopShell {
   lda rRegNumItemsOnPage+IO1Port
   bne +
   jmp GeosStatusDone
+
   lda rwRegCursorItemOnPg+IO1Port
   cmp rRegNumItemsOnPage+IO1Port
   bcc GeosStatusCursorOK
   lda #0
   sta rwRegCursorItemOnPg+IO1Port
GeosStatusCursorOK:
   sta rwRegSelItemOnPage+IO1Port
   lda rRegItemTypePlusIOH+IO1Port
   sta GeosWorkFlags
   and #$7f
   sta GeosWorkType

   ldx #19
   jsr GeosBlankLine
   ldx #20
   jsr GeosBlankLine

   ldx #19
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosSelected
   ldy #>MsgGeosSelected
   jsr PrintString
   lda #rsstItemName
   ldx #38
   jsr GeosPrintSerialLimited

   ldx #20
   ldy #0
   clc
   jsr SetCursor
   lda #PokeBlack
   sta $0286
   lda #<MsgGeosType
   ldy #>MsgGeosType
   jsr PrintString
   lda GeosWorkType
   asl
   asl
   tay
   iny
   lda #3
   sta GeosWorkCount
GeosPrintTypeLoop:
   lda TblItemType,y
   jsr SendChar
   iny
   dec GeosWorkCount
   bne GeosPrintTypeLoop

   lda GeosWorkFlags
   bpl GeosStatusNoHandler
   lda #<MsgGeosHandler
   ldy #>MsgGeosHandler
   jsr PrintString
GeosStatusNoHandler:
   lda #<MsgGeosItem
   ldy #>MsgGeosItem
   jsr PrintString
   lda rwRegCursorItemOnPg+IO1Port
   clc
   adc #1
   jsr PrintIntByte
   lda #'/'
   jsr SendChar
   lda rRegNumItemsOnPage+IO1Port
   jsr PrintIntByte
   lda #<MsgGeosPageStatus
   ldy #>MsgGeosPageStatus
   jsr PrintString
   lda rwRegPageNumber+IO1Port
   jsr PrintIntByte
   lda #'/'
   jsr SendChar
   lda rRegNumPages+IO1Port
   jsr PrintIntByte
}
GeosStatusDone:
   rts

; X=screen row.  Clears all 40 columns without changing menu state.
!ifndef DesktopShell {
GeosBlankLine:
   ldy #0
   clc
   jsr SetCursor
   lda #40
   sta GeosWorkCount
GeosBlankLineLoop:
   lda #ChrSpace
   jsr SendChar
   dec GeosWorkCount
   bne GeosBlankLineLoop
   rts
}

; Toggle only the eight-character label plate, leaving the icon artwork crisp.
; A is a page-local item index within the active build's page capacity.
GeosToggleSelection:
!ifdef DesktopShell {
   jmp GeosBitmapRefreshBrowserSelection
}
!ifndef DesktopShell {
   cmp #GeosPageCapacity
   bcs GeosToggleDone
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosToggleDone
   asl
   tax
   clc
   lda TblGeosCellScreen,x
   adc #80
   sta smcGeosToggleRead+1
   sta smcGeosToggleWrite+1
   lda TblGeosCellScreen+1,x
   adc #0
   sta smcGeosToggleRead+2
   sta smcGeosToggleWrite+2
   ldy #7
smcGeosToggleRead:
GeosToggleByte:
   lda $ffff,y
   eor #$80
smcGeosToggleWrite:
   sta $ffff,y
   dey
   bpl GeosToggleByte
GeosToggleDone:
   rts
}

; Stable selection entry point for a future pointing-device driver.
; Input: A=new page-local item (0..item count-1).  Output: C set on success.
GeosSetSelection:
   ldx GeosViewMode
   beq GeosSetSelectionFail
   cmp #GeosPageCapacity
   bcs GeosSetSelectionFail
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosSetSelectionFail
!ifdef DesktopShell {
   cmp rwRegCursorItemOnPg+IO1Port
   beq GeosSetSelectionStatusOnly
   sta rwRegCursorItemOnPg+IO1Port
   jsr GeosBitmapRefreshBrowserSelection
}
!ifndef DesktopShell {
   sta GeosWorkNewItem
   cmp rwRegCursorItemOnPg+IO1Port
   beq GeosSetSelectionStatusOnly
   lda rwRegCursorItemOnPg+IO1Port
   jsr GeosToggleSelection
   lda GeosWorkNewItem
   sta rwRegCursorItemOnPg+IO1Port
   jsr GeosToggleSelection
}
GeosSetSelectionStatusOnly:
   jsr GeosDrawStatus
   sec
   rts
GeosSetSelectionFail:
   clc
   rts

; Character-cell hit test for future mouse support.
; Input: X=screen column (0..39), Y=screen row.  Output: C=1/A=item for
; desktop grid rows only, otherwise C=0. Unpopulated cells are rejected.
GeosHitTest:
!ifdef DesktopShell { jmp GeosRichHitFile }
!ifndef DesktopShell {
   stx GeosWorkCol
   cpx #40
   bcs GeosHitTestFail
   tya
   cmp #GeosGridTop
   bcc GeosHitTestFail
   cmp #GeosGridTop+GeosGridRows*GeosCellHeight
   bcs GeosHitTestFail
   cmp #GeosGridTop+GeosCellHeight
   bcc GeosHitRow0
   cmp #GeosGridTop+GeosCellHeight*2
   bcc GeosHitRow1
   cmp #GeosGridTop+GeosCellHeight*3
   bcc GeosHitRow2
!ifdef DesktopShell {
   cmp #GeosGridTop+GeosCellHeight*4
   bcc GeosHitRow3
   lda #20
   bne GeosHitRowReady
GeosHitRow3:
}
   lda #15
   bne GeosHitRowReady
GeosHitRow2:
   lda #10
   bne GeosHitRowReady
GeosHitRow1:
   lda #5
   bne GeosHitRowReady
GeosHitRow0:
   lda #0
GeosHitRowReady:
   sta GeosWorkItem
   lda GeosWorkCol
   cmp #8
   bcc GeosHitCol0
   cmp #16
   bcc GeosHitCol1
   cmp #24
   bcc GeosHitCol2
   cmp #32
   bcc GeosHitCol3
   lda #4
   bne GeosHitColReady
GeosHitCol3:
   lda #3
   bne GeosHitColReady
GeosHitCol2:
   lda #2
   bne GeosHitColReady
GeosHitCol1:
   lda #1
   bne GeosHitColReady
GeosHitCol0:
   lda #0
GeosHitColReady:
   clc
   adc GeosWorkItem
   cmp #GeosPageCapacity
   bcs GeosHitTestFail
!ifdef DesktopShell {
   ldx GeosSurfaceMode
   cpx #GeosSurfaceIEC
   bne +
   cmp GeosIECCount
   bcs GeosHitTestFail
   sec
   rts
+
}
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosHitTestFail
   sec
   rts
GeosHitTestFail:
   clc
   rts
}

; Icon-view directional navigation.  Up/down preserve the grid column and
; cross page boundaries; left/right wrap within the current icon row.
GeosMoveUp:
!ifdef DesktopShell { jmp GeosBrowserCursorUp }
!ifndef DesktopShell {
   lda rRegNumItemsOnPage+IO1Port
   bne +
   rts
+
   lda rwRegCursorItemOnPg+IO1Port
   sta GeosWorkItem
   jsr GeosToggleSelection
   lda GeosWorkItem
   cmp #GeosGridColumns
   bcc GeosMoveUpWrap
   sec
   sbc #GeosGridColumns
   sta rwRegCursorItemOnPg+IO1Port
   rts

GeosMoveUpWrap:
   sta GeosWorkCol
   jsr PageUp
   lda rRegNumItemsOnPage+IO1Port
   beq GeosMoveDone
   lda GeosWorkCol
   cmp rRegNumItemsOnPage+IO1Port
   bcc GeosMoveUpSeed
   lda rRegNumItemsOnPage+IO1Port
   sec
   sbc #1
GeosMoveUpSeed:
   sta GeosWorkNewItem
GeosMoveUpLastRow:
   clc
   adc #GeosGridColumns
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosMoveUpSet
   sta GeosWorkNewItem
   jmp GeosMoveUpLastRow
GeosMoveUpSet:
   lda GeosWorkNewItem
   sta rwRegCursorItemOnPg+IO1Port
GeosMoveDone:
   rts
}

GeosMoveDown:
!ifdef DesktopShell { jmp GeosBrowserCursorDown }
!ifndef DesktopShell {
   lda rRegNumItemsOnPage+IO1Port
   bne +
   rts
+
   lda rwRegCursorItemOnPg+IO1Port
   sta GeosWorkItem
   jsr GeosToggleSelection
   lda GeosWorkItem
   clc
   adc #GeosGridColumns
   cmp rRegNumItemsOnPage+IO1Port
   bcs GeosMoveDownWrap
   sta rwRegCursorItemOnPg+IO1Port
   rts

GeosMoveDownWrap:
   ldx GeosWorkItem
   lda TblGeosCellColumn,x
   sta GeosWorkCol
   jsr PageDown
   lda rRegNumItemsOnPage+IO1Port
   beq GeosMoveDone
   lda GeosWorkCol
   cmp rRegNumItemsOnPage+IO1Port
   bcc GeosMoveDownSet
   lda rRegNumItemsOnPage+IO1Port
   sec
   sbc #1
GeosMoveDownSet:
   sta rwRegCursorItemOnPg+IO1Port
   rts
}

GeosMoveLeft:
!ifdef DesktopShell { jmp GeosBrowserCursorLeft }
!ifndef DesktopShell {
   lda rRegNumItemsOnPage+IO1Port
   bne +
   rts
+
   lda rwRegCursorItemOnPg+IO1Port
   sta GeosWorkItem
   jsr GeosToggleSelection
   ldx GeosWorkItem
   lda TblGeosCellColumn,x
   beq GeosMoveLeftWrap
   dec GeosWorkItem
   lda GeosWorkItem
   sta rwRegCursorItemOnPg+IO1Port
   rts

GeosMoveLeftWrap:
   lda GeosWorkItem
   clc
   adc #GeosGridColumns-1
   cmp rRegNumItemsOnPage+IO1Port
   bcc GeosMoveLeftSet
   lda rRegNumItemsOnPage+IO1Port
   sec
   sbc #1
GeosMoveLeftSet:
   sta rwRegCursorItemOnPg+IO1Port
   rts
}

GeosMoveRight:
!ifdef DesktopShell { jmp GeosBrowserCursorRight }
!ifndef DesktopShell {
   lda rRegNumItemsOnPage+IO1Port
   bne +
   rts
+
   lda rwRegCursorItemOnPg+IO1Port
   sta GeosWorkItem
   jsr GeosToggleSelection
   ldx GeosWorkItem
   lda TblGeosCellColumn,x
   sta GeosWorkCol
   cmp #GeosGridColumns-1
   beq GeosMoveRightWrap
   inx
   cpx rRegNumItemsOnPage+IO1Port
   bcs GeosMoveRightWrap
   stx rwRegCursorItemOnPg+IO1Port
   rts

GeosMoveRightWrap:
   lda GeosWorkItem
   sec
   sbc GeosWorkCol
   sta rwRegCursorItemOnPg+IO1Port
   rts
}

; Public layout tables are also useful to a mouse driver that wants to convert
; pixel coordinates to desktop cells before calling GeosSetSelection.
!ifndef DesktopShell {
TblGeosCellRow:
!ifdef DesktopShell { !byte 5,5,5,5, 9,9,9,9, 14,14,14,14, 18,18,18,18 }
!ifndef DesktopShell {
   !byte 3,3,3,3,3, 7,7,7,7,7, 11,11,11,11,11, 15,15,15,15
}
TblGeosCellCol:
!ifdef DesktopShell { !byte 1,10,19,28, 1,10,19,28, 1,10,19,28, 1,10,19,28 }
!ifndef DesktopShell {
   !byte 0,8,16,24,32, 0,8,16,24,32, 0,8,16,24,32, 0,8,16,24
}
TblGeosCellColumn:
!ifdef DesktopShell { !byte 0,1,2,3, 0,1,2,3, 0,1,2,3, 0,1,2,3 }
!ifndef DesktopShell {
   !byte 0,1,2,3,4, 0,1,2,3,4, 0,1,2,3,4, 0,1,2,3
}
TblGeosCellScreen:
   !word GeosLayoutScreen+40*3+0
   !word GeosLayoutScreen+40*3+8
   !word GeosLayoutScreen+40*3+16
   !word GeosLayoutScreen+40*3+24
   !word GeosLayoutScreen+40*3+32
   !word GeosLayoutScreen+40*7+0
   !word GeosLayoutScreen+40*7+8
   !word GeosLayoutScreen+40*7+16
   !word GeosLayoutScreen+40*7+24
   !word GeosLayoutScreen+40*7+32
   !word GeosLayoutScreen+40*11+0
   !word GeosLayoutScreen+40*11+8
   !word GeosLayoutScreen+40*11+16
   !word GeosLayoutScreen+40*11+24
   !word GeosLayoutScreen+40*11+32
   !word GeosLayoutScreen+40*15+0
   !word GeosLayoutScreen+40*15+8
   !word GeosLayoutScreen+40*15+16
   !word GeosLayoutScreen+40*15+24
!ifdef DesktopShell {
   !word GeosLayoutScreen+40*15+32
   !word GeosLayoutScreen+40*19+0
   !word GeosLayoutScreen+40*19+8
   !word GeosLayoutScreen+40*19+16
   !word GeosLayoutScreen+40*19+24
   !word GeosLayoutScreen+40*19+32
}

}

!ifndef DesktopShell {
MsgGeosTitleBar:
   !tx ChrRvsOn, " TeensyROM Desktop  V VIEW   F2 BASIC   ", ChrRvsOff, 0
MsgGeosSource:
   !tx "Source: ", 0
MsgGeosPage:
   !tx "Pg ", 0
MsgGeosPath:
   !tx "Path: ", 0
MsgGeosFooter1:
   !tx "F1 TEENSY  F3 SD  F5 USB  F7 HELP       ", 0
MsgGeosFooter2:
   !tx "CURSOR/JOY MOVE   RETURN/FIRE OPEN      ", 0
MsgGeosFooter3:
   !tx "^ PARENT  HOME TOP  F4 MUSIC  F8 SET   ", 0
}
!ifndef DesktopShell {
MsgGeosSelected:
   !tx "> ", 0
MsgGeosType:
   !tx "TYPE ", 0
MsgGeosHandler:
   !tx " IO", 0
MsgGeosItem:
   !tx "  ITEM ", 0
MsgGeosPageStatus:
   !tx "  PAGE ", 0
}

; Four 24x16 monochrome icons.  Each six-glyph group is ordered as three
; glyphs across the top row, followed by three across the bottom row.
!ifndef DesktopShell {
GeosIconData:
   ;Folder with a raised tab.
   !byte %00000000,%00000000,%00001111,%00001000,%00001000,%00111111,%00100000,%00100000
   !byte %00000000,%00000000,%11110000,%00010000,%00010000,%11111111,%00000000,%00000000
   !byte %00000000,%00000000,%00000000,%00000000,%00000000,%11111100,%00000100,%00000100
   !byte %00100000,%00101111,%00100000,%00100000,%00100000,%00100000,%00111111,%00000000
   !byte %00000000,%11111111,%00000000,%00000000,%00000000,%00000000,%11111111,%00000000
   !byte %00000100,%11110100,%00000100,%00000100,%00000100,%00000100,%11111100,%00000000

   ;Floppy disk with label and lower shutter.
   !byte %00000000,%00001111,%00001000,%00001001,%00001001,%00001001,%00001001,%00001000
   !byte %00000000,%11111111,%00000000,%11111111,%00000001,%00000001,%11111111,%00000000
   !byte %00000000,%11110000,%00010000,%10010000,%10010000,%10010000,%10010000,%00010000
   !byte %00001000,%00001001,%00001001,%00001001,%00001001,%00001001,%00001111,%00000000
   !byte %00000000,%11111111,%00000000,%01111110,%00000000,%11111111,%11111111,%00000000
   !byte %00010000,%10010000,%10010000,%10010000,%10010000,%10010000,%11110000,%00000000

   ;Document with folded corner and text strokes.
   !byte %00000000,%00000111,%00000100,%00000100,%00000100,%00000100,%00000100,%00000100
   !byte %00000000,%11111111,%00000010,%00000010,%00000010,%00000011,%00000000,%00000000
   !byte %00000000,%11100000,%00100000,%00100000,%00100000,%11100000,%00100000,%00100000
   !byte %00000100,%00000100,%00000100,%00000100,%00000100,%00000100,%00000111,%00000000
   !byte %11111111,%00000000,%11111111,%00000000,%11111110,%00000000,%11111111,%00000000
   !byte %00100000,%00100000,%00100000,%00100000,%00100000,%00100000,%11100000,%00000000

   ;Program/application window with tiny controls and content marks.
   !byte %00000000,%00000000,%00111111,%00101010,%00100000,%00111111,%00100000,%00100000
   !byte %00000000,%00000000,%11111111,%10000000,%00000000,%11111111,%00000000,%00000000
   !byte %00000000,%00000000,%11111100,%00000100,%00000100,%11111100,%00000100,%00000100
   !byte %00100111,%00100100,%00100100,%00100100,%00100111,%00100000,%00111111,%00000000
   !byte %11100111,%00100000,%00100111,%00100000,%11100111,%00000000,%11111111,%00000000
   !byte %11100100,%00000100,%11100100,%00000100,%11000100,%00000100,%11111100,%00000000
GeosIconDataEnd:
}



GeosWorkItem:
   !byte 0
GeosWorkNewItem:
   !byte 0
GeosWorkCol:
   !byte 0
GeosWorkCount:
   !byte 0
GeosWorkType:
   !byte 0
GeosWorkFlags:
   !byte 0
GeosWorkIcon:
   !byte 0
