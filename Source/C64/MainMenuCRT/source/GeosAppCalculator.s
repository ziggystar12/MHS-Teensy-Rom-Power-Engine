; Native signed 16-bit integer calculator. All storage belongs to the app bank.
; The common frame owns title/close and clears the interior before CalcDraw.
; Entry range: 0..32767. Results: -32768..32767; division truncates toward zero.
CalcInit:
   lda #0
   ldx #CalcStateEnd-CalcValue-1
CalcClearLoop:
   sta CalcValue,x
   dex
   bpl CalcClearLoop
CalcChanged:
   lda #1
   sta AppDirty
CalcDone:
   rts

CalcKey:
   cld
   cmp #$43                   ;C, including shifted PETSCII C
   beq CalcInit
   cmp #$c3
   beq CalcInit
   cmp #$63
   beq CalcInit
   cmp #$30
   bcc CalcCommandJump
   cmp #$3a
   bcc CalcDigitStart
CalcCommandJump:
   jmp CalcCommand
CalcDigitStart:
   and #15
   pha
   lda CalcError
   beq +
   jsr CalcInit
+  lda CalcFresh
   beq +
   lda #0
   sta CalcValue
   sta CalcValue+1
   sta CalcFresh
+  pla
   sta CalcDigit
   ;Reject the next digit before 16-bit multiplication can wrap.
   lda CalcValue+1
   cmp #$0c
   bcc CalcAppend
   bne CalcSetError
   lda CalcValue
   cmp #$cc                   ;3276
   bcc CalcAppend
   bne CalcSetError
   lda CalcDigit
   cmp #8
   bcs CalcSetError
CalcAppend:
   lda CalcValue
   sta CalcTemp
   lda CalcValue+1
   sta CalcTemp+1
   asl CalcValue
   rol CalcValue+1
   asl CalcValue
   rol CalcValue+1
   clc
   lda CalcValue
   adc CalcTemp
   sta CalcValue
   lda CalcValue+1
   adc CalcTemp+1
   sta CalcValue+1
   asl CalcValue
   rol CalcValue+1
   lda CalcValue
   clc
   adc CalcDigit
   sta CalcValue
   bcc +
   inc CalcValue+1
+  jmp CalcChanged
CalcSetError:
   lda #1
   sta CalcError
   jmp CalcChanged

CalcCommand:
   cmp #13
   bne +
   lda #$3d
+  cmp #$3d
   beq CalcAcceptCommand
   cmp #$2b
   beq CalcAcceptCommand
   cmp #$2d
   beq CalcAcceptCommand
   cmp #$2a
   beq CalcAcceptCommand
   cmp #$2f
   beq CalcAcceptCommand
CalcCommandDone:
   rts
CalcAcceptCommand:
   sta CalcCommandKey
   lda CalcError
   bne CalcCommandDone
   lda CalcFresh
   bne CalcSaveOperator
   jsr CalcCompute
   lda CalcError
   bne CalcCommandDone
CalcSaveOperator:
   lda CalcValue
   sta CalcLeft
   lda CalcValue+1
   sta CalcLeft+1
   lda CalcCommandKey
   cmp #$3d
   bne +
   lda #0
+  sta CalcOperator
   lda #1
   sta CalcFresh
   jmp CalcChanged

CalcCompute:
   lda CalcOperator
   beq CalcMathDone
   cmp #$2b
   beq CalcAdd
   cmp #$2d
   beq CalcSubtract
   lda CalcValue+1
   eor CalcLeft+1
   and #$80
   sta CalcSign
   ldx #0
   jsr CalcAbsolute
   ldx #2
   jsr CalcAbsolute
   lda #0
   sta CalcTemp
   sta CalcTemp+1
   lda CalcOperator
   cmp #$2f
   beq CalcDivide
   jmp CalcMultiply
CalcAdd:
   clc
   lda CalcLeft
   adc CalcValue
   sta CalcValue
   lda CalcLeft+1
   adc CalcValue+1
   sta CalcValue+1
   bvs CalcMathError
CalcMathDone:
   rts
CalcSubtract:
   sec
   lda CalcLeft
   sbc CalcValue
   sta CalcValue
   lda CalcLeft+1
   sbc CalcValue+1
   sta CalcValue+1
   bvc CalcMathDone
CalcMathError:
   jmp CalcSetError

; CalcValue and CalcLeft are adjacent pairs, selected with X=0 or X=2.
CalcAbsolute:
   lda CalcValue+1,x
   bpl CalcMathDone
CalcNegate:
   sec
   lda #0
   sbc CalcValue,x
   sta CalcValue,x
   lda #0
   sbc CalcValue+1,x
   sta CalcValue+1,x
   rts

; Restoring unsigned division, exactly 16 rounds. Left becomes the quotient.
CalcDivide:
   lda CalcValue
   ora CalcValue+1
   beq CalcMathError
   ldx #16
CalcDivideLoop:
   asl CalcLeft
   rol CalcLeft+1
   rol CalcTemp
   rol CalcTemp+1
   lda CalcTemp+1
   cmp CalcValue+1
   bcc CalcDivideNext
   bne CalcDivideSubtract
   lda CalcTemp
   cmp CalcValue
   bcc CalcDivideNext
CalcDivideSubtract:
   sec
   lda CalcTemp
   sbc CalcValue
   sta CalcTemp
   lda CalcTemp+1
   sbc CalcValue+1
   sta CalcTemp+1
   inc CalcLeft
CalcDivideNext:
   dex
   bne CalcDivideLoop
   lda CalcLeft
   sta CalcValue
   lda CalcLeft+1
   sta CalcValue+1
   jmp CalcSignedResult

; Count with the smaller magnitude: valid products need at most 181 additions.
; Oversized products terminate on the first 16-bit carry, without wrapping.
CalcMultiply:
   lda CalcValue+1
   cmp CalcLeft+1
   bcc CalcMultiplyLoop
   bne CalcSwap
   lda CalcValue
   cmp CalcLeft
   bcc CalcMultiplyLoop
CalcSwap:
   ldx #1
CalcSwapLoop:
   lda CalcValue,x
   ldy CalcLeft,x
   sta CalcLeft,x
   tya
   sta CalcValue,x
   dex
   bpl CalcSwapLoop
CalcMultiplyLoop:
   lda CalcValue
   ora CalcValue+1
   beq CalcMultiplyDone
   clc
   lda CalcTemp
   adc CalcLeft
   sta CalcTemp
   lda CalcTemp+1
   adc CalcLeft+1
   sta CalcTemp+1
   bcs CalcProductError
   lda CalcValue
   bne +
   dec CalcValue+1
+  dec CalcValue
   jmp CalcMultiplyLoop
CalcMultiplyDone:
   lda CalcTemp
   sta CalcValue
   lda CalcTemp+1
   sta CalcValue+1
CalcSignedResult:
   lda CalcValue+1
   cmp #$80
   bcc CalcResultSign
   bne CalcProductError
   lda CalcValue
   bne CalcProductError
   lda CalcSign
   beq CalcProductError
CalcResultSign:
   lda CalcSign
   beq CalcResultDone
   ldx #0
   jmp CalcNegate
CalcProductError:
   jmp CalcSetError
CalcResultDone:
   rts

CalcDraw:
   ldx #40
   ldy #42
   jsr AppPosition
   lda #<CalcIntegerText
   ldy #>CalcIntegerText
   jsr RichText
   ldx #136
   ldy #42
   jsr AppPosition
   lda CalcError
   beq CalcDrawValue
   lda #<CalcErrorText
   ldy #>CalcErrorText
   jsr RichText
   jmp CalcDrawButtons
CalcDrawValue:
   lda CalcValue
   sta AppNumber
   lda CalcValue+1
   sta AppNumber+1
   bpl CalcDrawNumber
   lda #$2d
   jsr RichChar
   sec
   lda #0
   sbc AppNumber
   sta AppNumber
   lda #0
   sbc AppNumber+1
   sta AppNumber+1
CalcDrawNumber:
   jsr AppPrintNumber
CalcDrawButtons:
   lda #0
   sta CalcButton
CalcDrawButton:
   lda CalcButton
   and #3
   tax
   lda CalcColumns,x
   sta CalcDrawX
   lda CalcButton
   lsr
   lsr
   tax
   lda CalcRows,x
   sta CalcDrawY
   tay
   ldx CalcDrawX
   jsr AppPosition
   lda #48
   sta RichW
   lda #24
   sta RichH
   lda #0
   sta RichWHi
   lda #0
   jsr UiButton
   lda CalcDrawX
   clc
   adc #21
   tax
   lda CalcDrawY
   clc
   adc #8
   tay
   jsr AppPosition
   ldx CalcButton
   lda CalcKeys,x
   jsr RichChar
   inc CalcButton
   lda CalcButton
   cmp #16
   bne CalcDrawButton
   rts

; Cell-aligned hit boxes exactly match 48x24 pixel buttons and 8-pixel gutters.
CalcClick:
   txa
   sec
   sbc #5
   bcc CalcClickDone
   ldx #0
CalcClickColumn:
   cmp #7
   bcc CalcClickRemainder
   sbc #7
   inx
   bne CalcClickColumn
CalcClickRemainder:
   cmp #6
   bcs CalcClickDone
   cpx #4
   bcs CalcClickDone
   stx CalcButton
   tya
   sec
   sbc #9
   bcc CalcClickDone
   cmp #12
   bcs CalcClickDone
CalcClickRow:
   cmp #3
   bcc CalcClickKey
   sbc #3
   ldx CalcButton
   inx
   inx
   inx
   inx
   stx CalcButton
   bne CalcClickRow
CalcClickKey:
   ldx CalcButton
   lda CalcKeys,x
   jmp CalcKey
CalcClickDone:
   rts

CalcColumns: !byte 40,96,152,208
CalcRows: !byte 72,96,120,144
CalcKeys: !byte $37,$38,$39,$2f,$34,$35,$36,$2a,$31,$32,$33,$2d,$43,$30,$3d,$2b
CalcIntegerText: !text "INTEGER",0
CalcErrorText: !text "ERROR",0
CalcValue: !word 0
CalcLeft: !word 0
CalcTemp: !word 0
CalcSign: !byte 0
CalcOperator: !byte 0
CalcFresh: !byte 0
CalcError: !byte 0
CalcDigit: !byte 0
CalcCommandKey: !byte 0
CalcButton: !byte 0
CalcDrawX: !byte 0
CalcDrawY: !byte 0
CalcStateEnd:
