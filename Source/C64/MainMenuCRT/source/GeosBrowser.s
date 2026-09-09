; Five-row, four-column browser. Backend indices and IEC launch names remain untouched.
; Viewport/scroll arithmetic runs in the normal menu loop, never the mouse IRQ.
GeosBrowserReadState:
   lda #5
   sta BrowserVisibleRows
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   beq BrowserReadIEC
   lda rwRegViewTopLo+IO1Port
   sta BrowserTopRowLo
   lda rwRegViewTopHi+IO1Port
   sta BrowserTopRowHi
   lda rRegViewCountLo+IO1Port
   sta BrowserCountLo
   lda rRegViewCountHi+IO1Port
   jmp BrowserReadCount
BrowserReadIEC:
   lda GeosIECTopLo
   sta BrowserTopRowLo
   lda GeosIECTopHi
   sta BrowserTopRowHi
   lda GeosIECTotalLo
   sta BrowserCountLo
   lda GeosIECTotalHi
BrowserReadCount:
   sta BrowserCountHi
   lsr BrowserTopRowHi
   ror BrowserTopRowLo
   lsr BrowserTopRowHi
   ror BrowserTopRowLo
   lda BrowserCountLo
   clc
   adc #3
   sta BrowserRowsLo
   lda BrowserCountHi
   adc #0
   lsr
   sta BrowserRowsHi
   ror BrowserRowsLo
   lsr BrowserRowsHi
   ror BrowserRowsLo
   lda BrowserRowsLo
   sec
   sbc #5
   sta BrowserMaxRowLo
   lda BrowserRowsHi
   sbc #0
   sta BrowserMaxRowHi
   bcs +
   lda #0
   sta BrowserMaxRowLo
   sta BrowserMaxRowHi
+  lda BrowserDragging
   bne GeosBrowserGeometry
   lda BrowserTopRowLo
   sta BrowserRequestedRowLo
   lda BrowserTopRowHi
   sta BrowserRequestedRowHi

GeosBrowserGeometry:
   lda #140
   ldx BrowserVisibleRows
   cpx #17
   bne +
   lda #123
+  sta BrowserTrackHeight
   sta BrowserThumbH
   lda #48
   sta BrowserThumbY
   lda BrowserMaxRowLo
   ora BrowserMaxRowHi
   beq BrowserGeometryDone
   lda BrowserVisibleRows
   sta BrowserValueLo
   lda #0
   sta BrowserValueHi
   lda BrowserRowsLo
   sta BrowserDivisorLo
   lda BrowserRowsHi
   sta BrowserDivisorHi
   lda BrowserTrackHeight
   jsr BrowserScale
   lda BrowserQuotientLo
   cmp #11
   bcs +
   lda #11
+  sta BrowserThumbH
   lda BrowserRequestedRowLo
   sta BrowserValueLo
   lda BrowserRequestedRowHi
   sta BrowserValueHi
   lda BrowserMaxRowLo
   sta BrowserDivisorLo
   lda BrowserMaxRowHi
   sta BrowserDivisorHi
   lda BrowserTrackHeight
   sec
   sbc BrowserThumbH
   jsr BrowserScale
   lda BrowserQuotientLo
   clc
   adc #48
   sta BrowserThumbY
BrowserGeometryDone:
   rts

; floor(Value16 * A / Divisor16). A<=140, Value/Divisor<=32767, result<=65535.
; The sum is at most65533, safe for directory rows and the text viewer line cap.
BrowserScale:
   tax
   lda #0
   sta BrowserRemainderLo
   sta BrowserRemainderHi
   sta BrowserQuotientLo
   sta BrowserQuotientHi
   cpx #0
   beq BrowserScaleDone
BrowserScaleAdd:
   clc
   lda BrowserRemainderLo
   adc BrowserValueLo
   sta BrowserRemainderLo
   lda BrowserRemainderHi
   adc BrowserValueHi
   sta BrowserRemainderHi
BrowserScaleSubtract:
   lda BrowserRemainderLo
   cmp BrowserDivisorLo
   lda BrowserRemainderHi
   sbc BrowserDivisorHi
   bcc BrowserScaleNext
   sta BrowserRemainderHi
   lda BrowserRemainderLo
   sec
   sbc BrowserDivisorLo
   sta BrowserRemainderLo
   inc BrowserQuotientLo
   bne BrowserScaleSubtract
   inc BrowserQuotientHi
   jmp BrowserScaleSubtract
BrowserScaleNext:
   dex
   bne BrowserScaleAdd
BrowserScaleDone:
   rts

GeosBrowserScrollUp:
   lda #$ff
   bne BrowserScroll
GeosBrowserScrollDown:
   lda #1
   bne BrowserScroll
GeosBrowserPageUp:
   lda #$fb
   bne BrowserScroll
GeosBrowserPageDown:
   lda #5
BrowserScroll:
   sta BrowserDelta
   jsr GeosBrowserReadState
   ldx #0
   lda BrowserDelta
   bpl +
   dex
+  clc
   adc BrowserTopRowLo
   sta BrowserRequestedRowLo
   txa
   adc BrowserTopRowHi
   sta BrowserRequestedRowHi
   bpl GeosBrowserCommit
   lda #0
   sta BrowserRequestedRowLo
   sta BrowserRequestedRowHi

GeosBrowserCommit:
   jsr BrowserClamp
   lda BrowserRequestedRowLo
   cmp BrowserTopRowLo
   bne +
   lda BrowserRequestedRowHi
   cmp BrowserTopRowHi
   beq BrowserCommitDone
+  lda #0
   sta MouseOpenArmed
   lda BrowserRequestedRowHi
   sta BrowserTargetHi
   lda BrowserRequestedRowLo
   asl
   rol BrowserTargetHi
   asl
   rol BrowserTargetHi
   ldx GeosSurfaceMode
   cpx #GeosSurfaceIEC
   beq BrowserCommitIEC
   sta rwRegViewTopLo+IO1Port
   lda BrowserTargetHi
   sta rwRegViewTopHi+IO1Port
   jmp GeosShellRedraw
BrowserCommitIEC:
   sta GeosIECTopLo
   lda BrowserTargetHi
   sta GeosIECTopHi
   jsr GeosIECReadViewport
   jmp GeosShellRedraw
BrowserCommitDone:
   rts
BrowserClamp:
   lda BrowserRequestedRowLo
   cmp BrowserMaxRowLo
   lda BrowserRequestedRowHi
   sbc BrowserMaxRowHi
   bcc +
   lda BrowserMaxRowLo
   sta BrowserRequestedRowLo
   lda BrowserMaxRowHi
   sta BrowserRequestedRowHi
+  rts

GeosBrowserDragStart:
   jsr GeosBrowserReadState
   lda MouseFrameY
   sec
   sbc BrowserThumbY
   sta BrowserDragOffset
   lda #1
   sta BrowserDragging
   rts
GeosBrowserDragMove:
   lda BrowserThumbY
   pha
   lda BrowserTrackHeight
   sec
   sbc BrowserThumbH
   sta BrowserDivisorLo
   beq BrowserDragUnchanged
   lda #0
   sta BrowserDivisorHi
   lda MouseFrameY
   sec
   sbc BrowserDragOffset
   bcc BrowserDragFirst
   sbc #48
   bcs +
BrowserDragFirst:
   lda #0
+  cmp BrowserDivisorLo
   bcc +
   lda BrowserDivisorLo
+  pha
   lda BrowserMaxRowLo
   sta BrowserValueLo
   lda BrowserMaxRowHi
   sta BrowserValueHi
   pla
   jsr BrowserScale
   lda BrowserQuotientLo
   sta BrowserRequestedRowLo
   lda BrowserQuotientHi
   sta BrowserRequestedRowHi
   jsr GeosBrowserGeometry
BrowserDragUnchanged:
   pla
   cmp BrowserThumbY
   beq +
   sec
   rts
+  clc
   rts
GeosBrowserDragEnd:
   lda #0
   sta BrowserDragging
   jmp GeosBrowserCommit

GeosBrowserCursorUp:
   lda #$fc
   bne BrowserCursor
GeosBrowserCursorDown:
   lda #4
   bne BrowserCursor
GeosBrowserCursorLeft:
   lda #$ff
   bne BrowserCursor
GeosBrowserCursorRight:
   lda #1
BrowserCursor:
   sta BrowserDelta
   jsr GeosBrowserReadState
   lda BrowserCountLo
   ora BrowserCountHi
   bne +
   rts
+
   lda BrowserTopRowHi
   sta BrowserTargetHi
   lda BrowserTopRowLo
   asl
   rol BrowserTargetHi
   asl
   rol BrowserTargetHi
   sta BrowserTargetLo
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   beq +
   lda rwRegCursorItemOnPg+IO1Port
   jmp ++
+  lda GeosIECSelection
++ clc
   adc BrowserTargetLo
   sta BrowserTargetLo
   bcc +
   inc BrowserTargetHi
+  ldx #0
   lda BrowserDelta
   bpl +
   dex
+  clc
   adc BrowserTargetLo
   sta BrowserTargetLo
   txa
   adc BrowserTargetHi
   sta BrowserTargetHi
   bmi BrowserCursorDone
   lda BrowserTargetLo
   cmp BrowserCountLo
   lda BrowserTargetHi
   sbc BrowserCountHi
   bcc +
   rts
+  lda BrowserTargetHi
   sta BrowserRequestedRowHi
   lda BrowserTargetLo
   lsr BrowserRequestedRowHi
   ror
   lsr BrowserRequestedRowHi
   ror
   sta BrowserRequestedRowLo
   sec
   sbc BrowserTopRowLo
   tax
   lda BrowserRequestedRowHi
   sbc BrowserTopRowHi
   bmi BrowserCursorTop
   bne BrowserCursorBottom
   cpx #5
   bcc BrowserCursorKeep
BrowserCursorBottom:
   lda BrowserRequestedRowLo
   sec
   sbc #4
   sta BrowserRequestedRowLo
   bcs BrowserCursorTop
   dec BrowserRequestedRowHi
   jmp BrowserCursorTop
BrowserCursorKeep:
   lda BrowserTopRowLo
   sta BrowserRequestedRowLo
   lda BrowserTopRowHi
   sta BrowserRequestedRowHi
BrowserCursorTop:
   jsr BrowserClamp
   lda BrowserRequestedRowLo
   asl
   asl
   sta BrowserRemainderLo
   lda BrowserTargetLo
   sec
   sbc BrowserRemainderLo
   ldx GeosSurfaceMode
   cpx #GeosSurfaceIEC
   beq +
   sta rwRegCursorItemOnPg+IO1Port
   jmp ++
+  sta GeosIECSelection
++ jsr GeosBrowserCommit
   jsr GeosBitmapRefreshBrowserSelection
BrowserCursorDone:
   rts

; Display buffers are separate from the backend raw lookup and IEC records.
GeosBrowserCaptureHeader:
   lda #0
   sta BrowserDragging
   lda #rsstShortDirPath
   sta rwRegSerialString+IO1Port
   ldx #0
BrowserCapturePath:
   lda rwRegSerialString+IO1Port
   beq BrowserPathDone
   jsr BrowserPETSCIIToASCII
   cpx #44
   bcs BrowserCapturePath
   sta GeosBrowserPath,x
   inx
   bne BrowserCapturePath
BrowserPathDone:
   sta GeosBrowserPath,x
   lda rWRegCurrMenuWAIT+IO1Port
   asl
   tax
   lda TblMsgMenuName,x
   sta BrowserTitleRead+1
   lda TblMsgMenuName+1,x
   sta BrowserTitleRead+2
   ldx #0
BrowserTitleRead:
   lda $ffff,x
   beq BrowserTitleDone
   jsr BrowserLocalPETSCIIToASCII
   sta GeosBrowserTitle,x
   inx
   cpx #16
   bne BrowserTitleRead
   lda #0
BrowserTitleDone:
   sta GeosBrowserTitle,x
   jmp GeosBrowserReadState

; ACME !convtab pet emits uppercase at $c1-$da, unlike the backend's
; $61-$7a spelling. Keep local title literals separate from its display wire.
BrowserLocalPETSCIIToASCII:
   cmp #$c1
   bcc BrowserPETSCIIToASCII
   cmp #$db
   bcs BrowserPETSCIIToASCII
   and #$7f
   rts

; Inverse of the backend ASCIItoPETSCII display table. Raw filename selectors
; never pass through this routine. The backend normalizes backslash/grave.
BrowserPETSCIIToASCII:
   cmp #$a4
   bne +
   lda #$5f                 ;underscore, not the dollar-sign glyph
   rts
+  cmp #$b3
   bne +
   lda #$7b
   rts
+  cmp #$ab
   bne +
   lda #$7d
   rts
+  cmp #$b2
   bne +
   lda #$7e
   rts
+  cmp #$7d
   bne +
   lda #$7c
   rts
+
   cmp #$41
   bcc BrowserDisplayASCII
   cmp #$5b
   bcc BrowserSwapCase
   cmp #$61
   bcc BrowserDisplayASCII
   cmp #$7b
   bcs BrowserDisplayASCII
BrowserSwapCase:
   eor #$20
BrowserDisplayASCII:
   cmp #32
   bcc BrowserUnknownGlyph
   cmp #127
   bcc +
BrowserUnknownGlyph:
   lda #'?'
+  rts

BrowserThumbY: !byte 48
BrowserVisibleRows: !byte 5
BrowserTrackHeight: !byte 140
BrowserThumbH: !byte 140
BrowserDragging: !byte 0
BrowserDragOffset: !byte 0
BrowserTopRowLo: !byte 0
BrowserTopRowHi: !byte 0
BrowserCountLo: !byte 0
BrowserCountHi: !byte 0
BrowserRowsLo: !byte 0
BrowserRowsHi: !byte 0
BrowserMaxRowLo: !byte 0
BrowserMaxRowHi: !byte 0
BrowserRequestedRowLo: !byte 0
BrowserRequestedRowHi: !byte 0
BrowserDelta: !byte 0
BrowserTargetLo: !byte 0
BrowserTargetHi: !byte 0
BrowserValueLo: !byte 0
BrowserValueHi: !byte 0
BrowserDivisorLo: !byte 0
BrowserDivisorHi: !byte 0
BrowserRemainderLo: !byte 0
BrowserRemainderHi: !byte 0
BrowserQuotientLo: !byte 0
BrowserQuotientHi: !byte 0
GeosBrowserIcons: !fill DesktopViewportItems,0
GeosBrowserTitle: !fill 17,0
GeosBrowserPath: !fill 45,0
