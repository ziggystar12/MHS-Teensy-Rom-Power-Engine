; Multi-app dispatcher used only by the hardware-free VICE preview and its
; instruction-level integration tests.
AppEnter:
   cld
   sta AppID
   lda #0
   sta AppExit
   sta AppFrameReady
   sta GeosBitmapActive
   sta MouseClickEdge
   sta MouseOpenArmed
   lda #$ff
   sta AppJoyLast
   lda AppID
   beq AppInitSnake
   cmp #1
   beq AppInitCalc
   jsr TextInit
   jmp AppRedraw
AppInitSnake:
   jsr SnakeInit
   jmp AppRedraw
AppInitCalc:
   jsr CalcInit
AppRedraw:
   lda AppDirty
   sta AppRenderMode
   lda #0
   sta AppDirty
   jsr AppBegin
   lda AppID
   beq AppDrawSnake
   cmp #1
   beq AppDrawCalc
   jsr TextDraw
   jmp AppDrawDone
AppDrawSnake:
   jsr SnakeDraw
   jmp AppDrawDone
AppDrawCalc:
   jsr CalcDraw
AppDrawDone:
   jsr GeosRichPublish
   jsr GeosBitmapPublishColors
   lda RichSavedBank
   sta $01
AppLoop:
   jsr GeosRichClock
   lda $a2
   sta AppTick
   lda AppID
   bne +
   jsr SnakeTick
+  jsr GetIn
   beq AppJoystick
   jsr AppKey
AppJoystick:
   lda Joystick2Sample
   cmp AppJoyLast
   beq AppMouse
   sta AppJoyLast
   ldx #0
-  lsr
   bcc +
   inx
   cpx #5
   bne -
   beq AppMouse
+  lda AppJoyKeys,x
   jsr AppKey
AppMouse:
   php
   sei
   lda MouseLogicalX
   sta MouseFrameX
   lda MouseLogicalY
   sta MouseFrameY
   lda MouseLeftDown
   sta MouseFrameDown
   lda MouseClickEdge
   sta AppClick
   lda #0
   sta MouseClickEdge
   plp
   lda MouseActive
   beq AppCheckDone
   lda #1
   sta MouseMenuEnabled
   jsr Mouse1351ShowPointer
   lda AppID
   cmp #2
   bcc +
   jsr TextDragFrame
+  lda AppClick
   beq AppCheckDone
   lda #<AppWindowRect
   ldy #>AppWindowRect
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcs AppClose
   lda MouseFrameX
   lsr
   lsr
   tax
   lda MouseFrameY
   lsr
   lsr
   lsr
   tay
AppBodyClick:
   lda AppID
   beq AppClickSnake
   cmp #1
   beq AppClickCalc
   jsr TextClick
   jmp AppCheckDone
AppClickSnake:
   jsr SnakeClick
   jmp AppCheckDone
AppClickCalc:
   jsr CalcClick
AppCheckDone:
   lda AppExit
   bne AppReturn
   lda AppDirty
   bne +
   jmp AppLoop
+
   jmp AppRedraw
AppClose:
   lda #1
   sta AppExit
AppReturn:
   lda #0
   sta MouseClickEdge
   sta MouseOpenArmed
   sta GeosMouseWasDown
   sta GeosDragActive
   sta BrowserDragging
   lda #$ff
   sta GeosDragCandidate
   lda AppExit
   rts
AppKey:
   cmp #ChrStop
   beq AppCloseKey
   cmp #27
   beq AppCloseKey
   cmp #ChrHome
   beq AppCloseKey
   ldx AppID
   beq +
   cpx #1
   beq ++
   jmp TextKey
+  jmp SnakeKey
++ jmp CalcKey
AppCloseKey:
   lda #1
   sta AppExit
   rts

; A framed monochrome app window over the desktop. All drawing stays offscreen.
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
+
   jmp AppClearInterior
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
   ldx AppID
   cpx #3
   bcc +
   ldx #2
+  lda AppTitleLo,x
   ldy AppTitleHi,x
   jmp RichText
AppWindowRect: !byte 4,0,12,56,1,176

; Interior is 36 whole bitmap cells across, rows4..22. Clear straight bytes,
; not thousands of individual pixel operations; keep window chrome intact.
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

AppJoyKeys: !byte ChrCRSRUp,ChrCRSRDn,ChrCRSRLeft,ChrCRSRRight,ChrReturn
AppTitleLo: !byte <AppTitleSnake,<AppTitleCalc,<AppTitleText
AppTitleHi: !byte >AppTitleSnake,>AppTitleCalc,>AppTitleText
AppTitleSnake: !tx "SNAKE",0
AppTitleCalc: !tx "CALCULATOR",0
AppTitleText: !tx "TEXT VIEWER",0
AppPowersLo: !byte <10000,<1000,<100,<10,<1
AppPowersHi: !byte >10000,>1000,>100,>10,>1
AppID: !byte 0
AppExit: !byte 0
AppDirty: !byte 0
AppFrameReady: !byte 0
AppRenderMode: !byte 0
AppClick: !byte 0
AppJoyLast: !byte $ff
AppTick: !byte 0
AppNumber: !word 0
AppNumIndex: !byte 0
AppNumDigit: !byte 0
AppNumLeading: !byte 0
