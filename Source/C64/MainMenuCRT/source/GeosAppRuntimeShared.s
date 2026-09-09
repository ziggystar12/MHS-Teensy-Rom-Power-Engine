; Shared framed-window and number routines used by each separately assembled
; utility. The app dispatcher supplies AppTitleLo/Hi and private state.
AppBegin:
   jsr GeosRichBegin
   lda #>(GeosLayoutScreen-C64ScreenRAM)
   sta GeosBitmapColorOffset
   lda AppFrameReady
   beq AppCreateWindow
   lda AppRenderMode
   cmp #2
   bne +
   rts
+  jmp AppClearInterior
AppCreateWindow:
   inc AppFrameReady
   jsr GeosRichHome
   lda #<AppWindowRect
   ldy #>AppWindowRect
   jsr UiLoadRect
   jsr UiWindow
   ldx #20
   ldy #16
   jsr AppPosition
   lda #AppTitleLo
   ldy #AppTitleHi
   jmp RichText
AppWindowRect: !byte 4,0,12,56,1,176

; Interior is 36 whole bitmap cells across, rows4..22. Clear straight bytes,
; preserving the window chrome around it.
AppClearInterior:
   lda #$10
   sta AppClearPage+1
   sta AppClearTail+1
   lda #$a5
   sta AppClearPage+2
   lda #$a6
   sta AppClearTail+2
   ldx #19
AppClearRow:
   lda #0
   ldy #0
AppClearPage:
   sta $a510,y
   iny
   bne AppClearPage
   ldy #31
AppClearTail:
   sta $a610,y
   dey
   bpl AppClearTail
   lda AppClearPage+1
   clc
   adc #$40
   sta AppClearPage+1
   sta AppClearTail+1
   lda AppClearPage+2
   adc #1
   sta AppClearPage+2
   clc
   adc #1
   sta AppClearTail+2
   dex
   bne AppClearRow
   rts

AppPosition:
   stx RichX
   sty RichY
   lda #0
   sta RichXHi
   lda #$ff
   sta RichInk
   rts

; Unsigned decimal; caller handles a sign if needed. AppNumber is consumed.
AppPrintNumber:
   lda #0
   sta AppNumIndex
   sta AppNumLeading
AppNumberDigit:
   lda #'0'
   sta AppNumDigit
   ldx AppNumIndex
AppNumberSubtract:
   lda AppNumber
   sec
   sbc AppPowersLo,x
   tay
   lda AppNumber+1
   sbc AppPowersHi,x
   bcc AppNumberEmit
   sta AppNumber+1
   sty AppNumber
   inc AppNumDigit
   bne AppNumberSubtract
AppNumberEmit:
   lda AppNumDigit
   cmp #'0'
   bne +
   lda AppNumLeading
   bne +
   cpx #4
   bne AppNumberNext
+  lda #1
   sta AppNumLeading
   lda AppNumDigit
   jsr RichChar
AppNumberNext:
   inc AppNumIndex
   lda AppNumIndex
   cmp #5
   bne AppNumberDigit
   rts

AppPowersLo: !byte <10000,<1000,<100,<10,<1
AppPowersHi: !byte >10000,>1000,>100,>10,>1
