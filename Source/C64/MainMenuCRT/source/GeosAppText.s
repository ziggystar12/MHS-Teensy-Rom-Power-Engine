; Read-only text viewer. Count wrapped lines once, then reopen/skip only on a
; committed scroll. The active app borrows browser arithmetic/scrollbar state;
; returning to the desktop restores directory state from its original source.
TextInit:
   lda #0
   sta TextKnown
   sta BrowserTopRowLo
   sta BrowserTopRowHi
   sta BrowserRequestedRowLo
   sta BrowserRequestedRowHi
   sta BrowserDragging
   lda #17
   sta BrowserVisibleRows
   rts
TextKey:
   cmp #ChrCRSRUp
   beq TextPrevious
   cmp #ChrCRSRDn
   beq TextNext
   cmp #ChrCRSRLeft
   beq TextPageUp
   cmp #ChrReturn
   beq TextPageDown
   cmp #ChrSpace
   beq TextPageDown
   cmp #ChrCRSRRight
   beq TextPageDown
   and #$7f
   ora #$20
   cmp #$6f
   bne TextDone
TextOpen:
   lda AppBackendAvailable
   beq TextDone
   lda #2
   sta AppExit
TextDone:
   rts
TextPrevious:
   lda #$ff
   bne TextOffset
TextNext:
   lda #1
   bne TextOffset
TextPageUp:
   lda #$ef
   bne TextOffset
TextPageDown:
   lda #17
TextOffset:
   ldx #0
   cmp #128
   bcc +
   dex
+  clc
   adc BrowserTopRowLo
   sta BrowserRequestedRowLo
   txa
   adc BrowserTopRowHi
   sta BrowserRequestedRowHi
   bpl TextCommit
   lda #0
   sta BrowserRequestedRowLo
   sta BrowserRequestedRowHi
TextCommit:
   jsr BrowserClamp
   lda BrowserRequestedRowLo
   cmp BrowserTopRowLo
   bne +
   lda BrowserRequestedRowHi
   cmp BrowserTopRowHi
   beq TextDone
+  lda BrowserRequestedRowLo
   sta BrowserTopRowLo
   lda BrowserRequestedRowHi
   sta BrowserTopRowHi
   lda #1
   sta AppDirty
   rts
TextClick:
   lda #<TextOpenRect
   ldy #>TextOpenRect
   jsr UiLoadRect
   jsr UiHit
   bcs TextOpen
   lda #<UiBrowserScroll
   ldy #>UiBrowserScroll
   jsr UiLoadRect
   jsr UiHit
   bcc TextDone
   lda MouseFrameY
   cmp #47
   bcc TextPrevious
   cmp #172
   bcs TextNext
   cmp BrowserThumbY
   bcc TextPageUp
   sec
   sbc BrowserThumbY
   cmp BrowserThumbH
   bcs TextPageDown
   sta BrowserDragOffset
   lda #1
   sta BrowserDragging
   rts
TextDragFrame:
   lda BrowserDragging
   bne +
   rts
+
   lda MouseFrameDown
   bne +
   sta BrowserDragging
   jmp TextCommit
+  jsr GeosBrowserDragMove
   bcs +
   rts
+  jmp GeosBrowserDrawScrollbar

TextDraw:
   lda #<TextWelcome
   sta TextReadDemo+1
   lda #>TextWelcome
   sta TextReadDemo+2
   lda AppID
   cmp #3
   bne TextReadStart
   lda #rCtlStartSelItemWAIT
   sta wRegControl+IO1Port
TextWait:
   lda rwRegStatus+IO1Port
   cmp #rsReady
   beq TextReadStart
   cmp #rsC64Message
   bne TextWait
   lda #rsstSerialStringBuf
   sta rwRegSerialString+IO1Port
-  lda rwRegSerialString+IO1Port
   bne -
   lda #rsContinue
   sta rwRegStatus+IO1Port
   jmp TextWait
TextReadStart:
   lda BrowserTopRowLo
   sta TextSkip
   lda BrowserTopRowHi
   sta TextSkip+1
   lda #0
   sta TextLastCR
   sta TextWrapped
   sta TextRow
   sta TextColumn
   lda TextKnown
   bne +
   lda #1
   sta BrowserRowsLo
   lda #0
   sta BrowserRowsHi
+  ldx #16
   ldy #36
   jsr AppPosition
TextReadLoop:
   jsr TextGetByte
   bcs TextHaveByte
   jmp TextEndFile
TextHaveByte:
   cmp #13
   beq TextCarriageReturn
   cmp #10
   bne +
   ldx TextLastCR
   beq TextLineFeed
   lda #0
   sta TextLastCR
   jmp TextReadLoop
TextLineFeed:
   ldx TextWrapped
   beq TextNewLine
   lda #0
   sta TextWrapped
   jmp TextReadLoop
+  ldx #0
   stx TextLastCR
   stx TextWrapped
   and #$7f
   cmp #32
   bcc TextReadLoop
   sta TextCharacter
   lda TextSkip
   ora TextSkip+1
   bne +
   lda TextRow
   cmp #17
   bcs +
   lda TextCharacter
   jsr RichChar
+  inc TextColumn
   lda TextColumn
   cmp #45
   bne TextReadLoop
   lda #1
   sta TextWrapped
   bne TextNewLine
TextCarriageReturn:
   lda #1
   sta TextLastCR
   lda TextWrapped
   beq TextNewLine
   lda #0
   sta TextWrapped
   jmp TextReadLoop
TextNewLine:
   lda #0
   sta TextColumn
   lda TextKnown
   bne TextMoveLine
   inc BrowserRowsLo
   bne TextMoveLine
   inc BrowserRowsHi
   bpl TextMoveLine
   ; Bounded16-bit row model: at least32767 lines. This exceeds the previous
   ; 255-page limit; the footer marks the capped count rather than claiming EOF.
   dec BrowserRowsHi
   dec BrowserRowsLo
   lda #2
   sta TextKnown
   jmp TextGeometry
TextMoveLine:
   lda TextSkip
   ora TextSkip+1
   beq +
   lda TextSkip
   bne ++
   dec TextSkip+1
++ dec TextSkip
   jmp TextReadLoop
+  lda TextRow
   cmp #17
   bcs TextHiddenRows
   inc TextRow
   lda TextRow
   cmp #17
   beq TextHiddenRows
   asl
   asl
   asl
   clc
   adc #36
   tay
   ldx #16
   jsr AppPosition
   jmp TextReadLoop
TextHiddenRows:
   lda TextKnown
   bne +
   jmp TextReadLoop
+  jmp TextGeometry
TextEndFile:
   lda TextKnown
   bne TextGeometry
   lda TextColumn
   bne +
   lda BrowserRowsLo
   bne ++
   dec BrowserRowsHi
++ dec BrowserRowsLo
+  lda #1
   sta TextKnown
TextGeometry:
   lda BrowserRowsLo
   sec
   sbc #17
   sta BrowserMaxRowLo
   lda BrowserRowsHi
   sbc #0
   sta BrowserMaxRowHi
   bcs +
   lda #0
   sta BrowserMaxRowLo
   sta BrowserMaxRowHi
+  jsr GeosBrowserGeometry
   lda #<UiBrowserScroll
   ldy #>UiBrowserScroll
   jsr UiLoadRect
   jsr UiScrollbar
TextFooter:
   lda #<TextOpenRect
   ldy #>TextOpenRect
   jsr UiLoadRect
   lda #0
   jsr UiButton
   ldx #20
   ldy #177
   jsr AppPosition
   lda #<TextOpenLabel
   ldy #>TextOpenLabel
   jsr RichText
   ldx #100
   ldy #177
   jsr AppPosition
   lda #$4c                  ;raw ASCII; direct RichChar never takes PETSCII
   jsr RichChar
   lda BrowserRowsLo
   ora BrowserRowsHi
   bne +
   sta AppNumber
   sta AppNumber+1
   beq ++
+  lda BrowserTopRowLo
   clc
   adc #1
   sta AppNumber
   lda BrowserTopRowHi
   adc #0
   sta AppNumber+1
++ jsr AppPrintNumber
   lda #'/'
   jsr RichChar
   lda BrowserRowsLo
   sta AppNumber
   lda BrowserRowsHi
   sta AppNumber+1
   jsr AppPrintNumber
   lda TextKnown
   cmp #2
   bne +
   lda #'+'
   jsr RichChar
+  rts

TextAvailable:
   lda AppID
   cmp #3
   bne +
   lda rRegStrAvailable+IO1Port
   rts
+  lda TextReadDemo+1
   sta TextPeekDemo+1
   lda TextReadDemo+2
   sta TextPeekDemo+2
TextPeekDemo:
   lda TextWelcome
   rts
TextGetByte:
   jsr TextAvailable
   beq TextNoByte
   lda AppID
   cmp #3
   bne TextReadDemo
   lda rRegStreamData+IO1Port
   sec
   rts
TextReadDemo:
   lda TextWelcome
   inc TextReadDemo+1
   bne +
   inc TextReadDemo+2
+  sec
   rts
TextNoByte:
   clc
   rts

TextOpenRect: !byte 16,0,175,48,0,11
TextOpenLabel: !tx "OPEN",0
TextWelcome:
   !tx "READ-ONLY TEXT",13,13
   !tx "OPEN TXT, NFO, MD OR SEQ.",13
   !tx "ARROWS/SCROLL BAR: SCROLL",13
   !tx "STOP/X: CLOSE",0
TextKnown: !byte 0
TextSkip: !word 0
TextRow: !byte 0
TextColumn: !byte 0
TextCharacter: !byte 0
TextLastCR: !byte 0
TextWrapped: !byte 0
