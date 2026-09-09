; Native bitmap Snake. Private state uses one byte per 16x12 board cell.
; The common app host owns the window, close box, mouse and canvas publish.
SnakeInit:
   lda AppTick
   sta SnakeLastTick
   ora #1
   sta SnakeRandom
   lda #0
   sta SnakeState
   sta SnakeDirection
   sta SnakePending
   lda #3
   sta SnakeLength
   ldx #2
   lda #$65
-  sta SnakeBody,x
   clc
   adc #1
   dex
   bpl -
   jsr SnakeFood
SnakeChanged:
   lda #1
   sta AppDirty
   rts

SnakeKey:
   ldx #0
   cmp #29                    ; right
   beq SnakeTurn
   inx
   cmp #17                    ; down
   beq SnakeTurn
   inx
   cmp #157                   ; left
   beq SnakeTurn
   inx
   cmp #145                   ; up
   beq SnakeTurn
   cmp #13                    ; joystick fire is mapped to RETURN by the host
   beq SnakePause
   and #$7f
   ora #$20                   ; accept either PETSCII letter case
   cmp #$72                   ; normalized ASCII, independent of !convtab pet
   beq SnakeInit
   cmp #$70
   beq SnakePause
   cmp #' '
   beq SnakePause
   cmp #$77
   beq SnakeTurn
   dex
   cmp #$61
   beq SnakeTurn
   dex
   cmp #$73
   beq SnakeTurn
   dex
   cmp #$64
   bne SnakeReturn
SnakeTurn:
   txa
   eor #2
   cmp SnakeDirection         ; compare with the last executed movement
   beq SnakeReturn            ; two keys in one tick cannot reverse the snake
   stx SnakePending
SnakeReturn:
   rts
SnakePause:
   lda SnakeState
   cmp #2
   bcs SnakeReturn
   eor #1
   sta SnakeState
   jmp SnakeChanged

; Mouse hit boxes exactly match the filled buttons drawn below.
SnakeClick:
   cpy #9                     ; pause: x184..287, y72..87
   bcc SnakeReturn
   cpy #11
   bcc SnakeClickWide
   cpy #12                    ; restart: x184..287, y96..111
   bcc SnakeReturn
   cpy #14
   bcc SnakeClickWide
   cpy #15                    ; up: x224..247, y120..135
   bcc SnakeReturn
   cpy #17
   bcc SnakeClickUp
   cpy #18                    ; left/down/right: y144..159
   bcc SnakeReturn
   cpy #20
   bcs SnakeReturn
   cpx #25
   bcc SnakeReturn
   cpx #34
   bcs SnakeReturn
   lda #157
   cpx #28
   bcc SnakeClickKey
   lda #17
   cpx #31
   bcc SnakeClickKey
   lda #29
SnakeClickKey:
   jmp SnakeKey
SnakeClickUp:
   cpx #28
   bcc SnakeReturn
   cpx #31
   bcs SnakeReturn
   lda #145
   bne SnakeClickKey
SnakeClickWide:
   cpx #23
   bcc SnakeReturn
   cpx #36
   bcs SnakeReturn
   cpy #11
   bcc SnakePause
   jmp SnakeInit

SnakeTick:
   lda AppTick
   sec
   sbc SnakeLastTick
   cmp #9
   bcs +
   rts
+
   lda AppTick
   sta SnakeLastTick
   lda SnakeState
   beq +
   rts
+
   ldx SnakeLength
   dex
   lda SnakeBody,x
   sta SnakeOldTail
   ldx SnakePending
   stx SnakeDirection
   lda SnakeBody
   clc
   adc SnakeSteps,x
   sta SnakeNext
   cmp #192                   ; top and bottom walls, including underflow
   bcs SnakeCrash
   txa
   and #1
   bne +
   lda SnakeNext
   eor SnakeBody
   and #$f0                   ; horizontal movement must stay on the same row
   bne SnakeCrash
+  ldx SnakeLength
   lda SnakeNext
   cmp SnakeFoodCell
   beq +
   dex                        ; a departing tail cell is safe when not growing
+  dex
-  cmp SnakeBody,x
   beq SnakeCrash
   dex
   bpl -
   cmp SnakeFoodCell
   bne +
   inc SnakeLength
+  ldx SnakeLength
   dex
-  lda SnakeBody-1,x
   sta SnakeBody,x
   dex
   bne -
   lda SnakeNext
   sta SnakeBody
   cmp SnakeFoodCell
   bne SnakeMoved
   lda SnakeLength
   cmp #64
   bcs SnakeWin
   jsr SnakeFood
   jmp SnakeChanged
SnakeMoved:
   lda #2                     ; only the departing tail and new head changed
   sta AppDirty
   rts
SnakeWin:
   lda #3
   !byte $2c                  ; skip the crash state's LDA immediate
SnakeCrash:
   lda #2
   sta SnakeState
   jmp SnakeChanged

; Full-period 8-bit generator. Reject walls and every occupied body cell.
SnakeFood:
   lda SnakeRandom
   asl
   asl
   clc
   adc SnakeRandom
   clc
   adc #1
   sta SnakeRandom
   cmp #192
   bcs SnakeFood
   ldx SnakeLength
   dex
-  cmp SnakeBody,x
   beq SnakeFood
   dex
   bpl -
   sta SnakeFoodCell
   rts

SnakeDraw:
   lda AppRenderMode
   cmp #2
   bne SnakeDrawFull
   lda SnakeOldTail
   jsr SnakeCellPosition
   lda #0
   sta RichInk
   jsr RichRect               ; erase before drawing: new head may be old tail
   lda SnakeBody
   jmp SnakeCell
SnakeDrawFull:
   ldx #31
   ldy #47
   jsr AppPosition
   lda #130
   sta RichW
   lda #98
   sta RichH
   lda #0
   sta RichWHi
   jsr UiFrame
   lda SnakeLength
   sta SnakeDrawIndex
SnakeDrawBody:
   dec SnakeDrawIndex
   ldx SnakeDrawIndex
   lda SnakeBody,x
   jsr SnakeCell
   lda SnakeDrawIndex
   bne SnakeDrawBody
   lda SnakeState
   cmp #3
   beq +                      ; the final food was eaten on the winning move
   lda SnakeFoodCell
   jsr SnakeCell
   inc RichX
   inc RichX
   inc RichY
   inc RichY
   lda #2
   sta RichW
   sta RichH
   lda #0
   sta RichInk
   jsr RichRect               ; food is hollow; the body is solid
+  ldx #184
   ldy #38
   jsr AppPosition
   lda #<SnakeScoreText
   ldy #>SnakeScoreText
   jsr RichText
   lda SnakeLength
   sec
   sbc #3
   sta AppNumber
   lda #0
   sta AppNumber+1
   jsr AppPrintNumber
   ldx #184
   ldy #54
   jsr AppPosition
   ldx SnakeState
   lda SnakeStateLo,x
   ldy SnakeStateHi,x
   jsr RichText
   lda #0
   sta SnakeDrawIndex
SnakeDrawButtons:
   ldx SnakeDrawIndex
   lda SnakeButtons+2,x
   sta RichW
   lda SnakeButtons+1,x
   tay
   lda SnakeButtons,x
   tax
   jsr AppPosition
   lda #16
   sta RichH
   lda #0
   sta RichWHi
   lda #0
   jsr UiButton
   lda RichX
   clc
   adc #4
   sta RichX
   lda RichY
   clc
   adc #4
   sta RichY
   ldx SnakeDrawIndex
   lda SnakeButtons+3,x
   ldy SnakeButtons+4,x
   jsr RichText
   lda SnakeDrawIndex
   clc
   adc #5
   sta SnakeDrawIndex
   cmp #30
   bcc SnakeDrawButtons
   ldx #24
   ldy #153
   jsr AppPosition
   lda #<SnakeKeysText
   ldy #>SnakeKeysText
   jsr RichText
   ldx #24
   ldy #165
   jsr AppPosition
   lda #<SnakePauseText
   ldy #>SnakePauseText
   jmp RichText

; Encoded cell A -> inset 6x6 square. Drawing routines may destroy CPU X/Y.
SnakeCell:
   jsr SnakeCellPosition
   jmp RichRect
SnakeCellPosition:
   pha
   and #$f0
   lsr
   clc
   adc #49
   tay
   pla
   and #15
   asl
   asl
   asl
   clc
   adc #33
   tax
   jsr AppPosition
   lda #6
   sta RichW
   sta RichH
   rts

SnakeSteps:       !byte 1,16,$ff,$f0
SnakeButtons:
   !byte 184,72,104,<SnakePauseButton,>SnakePauseButton
   !byte 184,96,104,<SnakeRestartButton,>SnakeRestartButton
   !byte 224,120,24,<SnakeUpText,>SnakeUpText
   !byte 200,144,24,<SnakeLeftText,>SnakeLeftText
   !byte 224,144,24,<SnakeDownText,>SnakeDownText
   !byte 248,144,24,<SnakeRightText,>SnakeRightText
SnakeStateLo:     !byte <SnakeRunning,<SnakePaused,<SnakeGameOver,<SnakeWon
SnakeStateHi:     !byte >SnakeRunning,>SnakePaused,>SnakeGameOver,>SnakeWon
SnakeScoreText:   !text "SCORE ",0
SnakeRunning:     !text "RUNNING",0
SnakePaused:      !text "PAUSED",0
SnakeGameOver:    !text "GAME OVER",0
SnakeWon:         !text "YOU WIN!",0
SnakePauseButton: !text "PAUSE/PLAY",0
SnakeRestartButton: !text "RESTART (R)",0
SnakeUpText:      !text "^",0
SnakeLeftText:    !text "<",0
SnakeDownText:    !text "V",0
SnakeRightText:   !text ">",0
SnakeKeysText:    !text "WASD / ARROWS",0
SnakePauseText:   !text "SPACE: PAUSE",0
SnakeState:       !byte 0       ; running, paused, crashed, won
SnakeDirection:   !byte 0
SnakePending:     !byte 0
SnakeLength:      !byte 3
SnakeLastTick:    !byte 0
SnakeRandom:      !byte 1
SnakeNext:        !byte 0
SnakeFoodCell:    !byte 0
SnakeDrawIndex:   !byte 0
SnakeOldTail:     !byte 0
SnakeBody:        !fill 64,0
