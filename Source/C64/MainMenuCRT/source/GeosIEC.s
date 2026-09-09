; IEC directory UI. Disk reads and sd2iec CD commands are isolated from the
; Teensy SD/USB source registers. PRGs launch through the KERNAL; no disk writes.

GeosIECOpenDrive:
   sta GeosIECDevice
   lda #GeosSurfaceIEC
   sta GeosSurfaceMode
   lda #0
   sta GeosOverlayMode
   sta GeosNotice
   sta GeosIECTopLo
   sta GeosIECTopHi
   sta MouseOpenArmed
   lda #$ff
   sta GeosDragCandidate
GeosIECRefresh:
   lda #0
   sta GeosIECTopLo
   sta GeosIECTopHi
   sta GeosIECSelection
   sta GeosIECStatusSeen
   sta MouseOpenArmed
   jsr GeosIECReadPage
   jmp GeosShellRedraw

GeosIECDraw:
   jsr TextScreenMemColor
   lda #ChrClear
   jsr SendChar
   jsr GeosIECCaptureHeader
   lda #0
   sta GeosWorkItem
GeosIECDrawLoop:
   lda GeosWorkItem
   cmp GeosIECCount
   bcs GeosIECDrawStatus
   jsr GeosIECGetEntry
   jsr GeosIECEntryIsDirectory
   bcc +
   lda #GeosIconFolder
   bne GeosIECDrawIcon
+  lda GeosIECEntry+16
   cmp #$50
   bne +
   lda #GeosIconProgram
   bne GeosIECDrawIcon
+  lda #GeosIconDocument
GeosIECDrawIcon:
   jsr GeosPutIcon
!ifdef DesktopShell {
   lda GeosWorkItem
   jsr GeosRichLabelStart
   ldx #0
GeosIECCaptureLabel:
   lda GeosIECEntry,x
   beq GeosIECLabelDone
   jsr GeosIECDisplayChar
GeosIECLabelPut:
   jsr GeosRichLabelPut
   inx
   cpx #16                    ;native filename only, never its trailing metadata
   bne GeosIECCaptureLabel
GeosIECLabelDone:
}
   inc GeosWorkItem
   jmp GeosIECDrawLoop
GeosIECDrawStatus:
   jsr GeosShellDrawOverlay
   jsr GeosBitmapConvertScreen
   lda GeosIECStatusSeen
   bne GeosIECDrawFinish
   lda GeosIECError
   beq +
   lda #<MsgIECError
   ldy #>MsgIECError
   jmp GeosIECShowStatus
+  lda GeosIECCount
   bne GeosIECDrawFinish
   lda #<MsgIECEmpty
   ldy #>MsgIECEmpty
GeosIECShowStatus:
   ldx #1
   stx GeosIECStatusSeen
   ldx #GeosOverlayNotice
   stx GeosOverlayMode
   jmp GeosBitmapShowMessage
GeosIECDrawFinish:
   rts

; Copy a 20-byte record while SID IRQs cannot change the zero-page pointer.
GeosIECGetEntry:
   sta GeosIECIndex
   php
   sei
   lda #<GeosIECEntries
   sta PtrAddrLo
   lda #>GeosIECEntries
   sta PtrAddrHi
   ldx GeosIECIndex
   beq GeosIECEntryCopy
-  clc
   lda PtrAddrLo
   adc #20
   sta PtrAddrLo
   bcc +
   inc PtrAddrHi
+  dex
   bne -
GeosIECEntryCopy:
   ldy #19
-  lda (PtrAddrLo),y
   sta GeosIECEntry,y
   dey
   bpl -
   plp
   rts
; DIR entries and .D64/.D71/.D81 images may be entered using sd2iec CD.
GeosIECEntryIsDirectory:
   lda GeosIECEntry+19
   bne GeosIECEntryCanEnter
   ldx #15
-  lda GeosIECEntry,x
   beq +
   cmp #$a0
   beq +
   cmp #' '
   bne GeosIECFindExtension
+  dex
   bpl -
   clc
   rts
GeosIECFindExtension:
   cpx #3
   bcc GeosIECEntryNotDirectory
   lda GeosIECEntry-3,x
   cmp #'.'
   bne GeosIECEntryNotDirectory
   lda GeosIECEntry-2,x
   and #$5f
   cmp #$44
   bne GeosIECEntryNotDirectory
   lda GeosIECEntry-1,x
   cmp #'6'
   bne +
   lda GeosIECEntry,x
   cmp #'4'
   beq GeosIECEntryCanEnter
+  lda GeosIECEntry-1,x
   cmp #'7'
   beq +
   cmp #'8'
   bne GeosIECEntryNotDirectory
+  lda GeosIECEntry,x
   cmp #'1'
   beq GeosIECEntryCanEnter
GeosIECEntryNotDirectory:
   clc
   rts
GeosIECEntryCanEnter:
   sec
   rts

GeosIECActivate:
   lda #0
   sta GeosIECStatusSeen
   lda GeosIECCount
   beq GeosIECActionDone
   lda GeosIECSelection
   jsr GeosIECGetEntry
   jsr GeosIECEntryIsDirectory
   bcs GeosIECEnterDirectory
   lda GeosIECEntry+16
   cmp #$50                  ;PRG; never treat SEQ/REL/USR data as a program
   bne GeosIECActionDone
   jmp GeosIECLaunchPRG
GeosIECEnterDirectory:
   ldx #15
-  lda GeosIECEntry,x
   beq +
   cmp #' '
   beq +
   cmp #$a0
   bne GeosIECCommandName
+  dex
   bpl -
   rts
GeosIECCommandName:
   txa
   clc
   adc #4
   sta GeosIECCommandLength
-  lda GeosIECEntry,x
   sta GeosIECCommand+3,x
   dex
   bpl -
   jmp GeosIECSendCD
GeosIECParent:
   lda #$5f                  ;PETSCII left arrow, sd2iec parent directory
   sta GeosIECCommand+3
   lda #4
   sta GeosIECCommandLength
GeosIECSendCD:
   lda #0
   sta GeosIECStatusSeen
   lda #$43
   sta GeosIECCommand
   lda #$44
   sta GeosIECCommand+1
   lda #':'
   sta GeosIECCommand+2
   jsr GeosIECChangeDir
   lda GeosIECError
   bne GeosIECRedraw
   lda #0
   sta GeosIECTopLo
   sta GeosIECTopHi
   jmp GeosIECRefresh
GeosIECActionDone:
   rts

GeosIECNextPage:
   jmp GeosBrowserPageDown
GeosIECPrevPage:
   jmp GeosBrowserPageUp
GeosIECMoveUp:
   jmp GeosBrowserCursorUp
GeosIECMoveDown:
   jmp GeosBrowserCursorDown
GeosIECMoveLeft:
   jmp GeosBrowserCursorLeft
GeosIECMoveRight:
   jmp GeosBrowserCursorRight
GeosIECSelect:
   cmp GeosIECCount
   bcs GeosIECSelectionDone
   cmp GeosIECSelection
   beq GeosIECSelectionDone
   sta GeosIECSelection
   jmp GeosBitmapRefreshBrowserSelection
GeosIECSelectionDone:
   rts
GeosIECRedraw:
   jmp GeosShellRedraw

; Do not let unrelated legacy actions operate on stale Teensy selections.
GeosIECHandleKey:
   cmp #ChrUpArrow
   bne +
   jsr GeosIECParent
   sec
   rts
+  cmp #'r'
   beq GeosIECRefreshKey
   cmp #'R'
   bne +
GeosIECRefreshKey:
   jsr GeosIECRefresh
   sec
   rts
+  cmp #MouseEventPagePrev
   bne +
   jsr GeosIECPrevPage
   sec
   rts
+  cmp #MouseEventPageNext
   bne +
   jsr GeosIECNextPage
   sec
   rts
+  cmp #ChrReturn
   beq GeosIECAllowKey
   cmp #ChrCRSRUp
   beq GeosIECAllowKey
   cmp #ChrCRSRDn
   beq GeosIECAllowKey
   cmp #ChrCRSRLeft
   beq GeosIECAllowKey
   cmp #ChrCRSRRight
   beq GeosIECAllowKey
   cmp #ChrHome
   beq GeosIECAllowKey
   cmp #ChrStop
   beq GeosIECAllowKey
   cmp #ChrRun
   beq GeosIECAllowKey
   cmp #ChrF1
   bcc GeosIECConsumeKey
   cmp #ChrF8+1
   bcc GeosIECAllowKey
   cmp #MouseEventMenuDesk
   bcc GeosIECConsumeKey
   cmp #MouseEventMenuDisk+1
   bcc GeosIECAllowKey
GeosIECConsumeKey:
   sec
   rts
GeosIECAllowKey:
   clc
   rts

GeosIECMouseClick:
   jsr GeosRichHitFile
   bcc GeosIECMouseNoTarget
   sta MouseHitItem
   lda MouseOpenArmed
   beq GeosIECMouseSelect
   lda GeosIECSelection
   cmp MouseHitItem
   bne GeosIECMouseSelect
   lda MouseLastClickedItem
   cmp MouseHitItem
   bne GeosIECMouseSelect
   lda #0
   sta MouseOpenArmed
   jsr GeosIECActivate
   clc
   rts
GeosIECMouseSelect:
   lda MouseHitItem
   sta MouseLastClickedItem
   lda #1
   sta MouseOpenArmed
   lda MouseHitItem
   jsr GeosIECSelect
   clc
   rts
GeosIECMouseNoTarget:
   jmp MouseNoTarget
MsgIECError: !tx "DRIVE NOT READY / DISK OR DOS ERROR",0
MsgIECEmpty: !tx "NO DIRECTORY ENTRIES",0
GeosIECSelection: !byte 0
GeosIECStatusSeen: !byte 0
GeosIECIndex: !byte 0
GeosIECNameLimit: !byte 0
GeosIECEntry: !fill 20,0

; IEC names are PETSCII byte strings, not ASCII FAT names. Preserve the raw
; sixteen-byte record for SETNAM/CD; normalize only the display copy.
GeosIECDisplayChar:
   cmp #$a0
   bne +
   lda #' '
+  cmp #$c1
   bcc +
   cmp #$db
   bcs +
   and #$7f
+  jmp BrowserDisplayASCII

GeosIECCaptureHeader:
   lda #0
   sta BrowserDragging
   ldx #7
-  lda MsgBrowserDrive,x
   sta GeosBrowserTitle,x
   dex
   bpl -
   lda GeosIECDevice
   clc
   adc #'0'
   sta GeosBrowserTitle+6
   ldx #0
-  lda GeosIECTitle,x
   beq +
   jsr GeosIECDisplayChar
   sta GeosBrowserPath,x
   inx
   cpx #16
   bne -
   lda #0
+  sta GeosBrowserPath,x
   jmp GeosBrowserReadState
MsgBrowserDrive: !text "Drive 8",0
