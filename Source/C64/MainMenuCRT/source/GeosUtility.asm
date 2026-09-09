; One utility per high-RAM PRG. A wrapper defines exactly one GeosUtility*
; symbol before including this source.
!convtab pet
!src "build/DesktopSymbols"
* = $c000
!src "source/GeosAppABI.s"

AppEnter:
   cld
!ifdef GeosUtilitySnake {
   lda #0
}
!ifdef GeosUtilityCalculator {
   lda #1
}
!ifdef GeosUtilityText {
   cmp #3
   beq +
   lda #2
+
}
   sta AppID
   lda #0
   sta AppExit
   sta AppFrameReady
   sta GeosBitmapActive
   sta MouseClickEdge
   sta MouseOpenArmed
   lda #$ff
   sta AppJoyLast
   jsr AppUtilityInit
AppRedraw:
   lda AppDirty
   sta AppRenderMode
   lda #0
   sta AppDirty
   jsr AppBegin
   jsr AppUtilityDraw
   jsr GeosRichPublish
   jsr GeosBitmapPublishColors
   lda RichSavedBank
   sta $01
AppLoop:
   jsr GeosRichClock
   lda $a2
   sta AppTick
   jsr AppUtilityTick
   jsr GetIn
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
!ifdef GeosUtilityText {
   jsr TextDragFrame
}
   lda AppClick
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
   jsr AppUtilityClick
AppCheckDone:
   lda AppExit
   bne AppReturn
   lda AppDirty
   bne +
   jmp AppLoop
+  jmp AppRedraw
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
   jmp AppUtilityKey
AppCloseKey:
   lda #1
   sta AppExit
   rts

!src "source/GeosAppRuntimeShared.s"

AppUtilityTick:
!ifdef GeosUtilitySnake {
   jmp SnakeTick
}
!ifndef GeosUtilitySnake {
   rts
}

!ifdef GeosUtilitySnake {
AppUtilityInit = SnakeInit
AppUtilityDraw = SnakeDraw
AppUtilityClick = SnakeClick
AppUtilityKey = SnakeKey
AppTitleLo = <AppTitle
AppTitleHi = >AppTitle
AppTitle: !tx "SNAKE",0
   !src "source/GeosAppSnake.s"
}
!ifdef GeosUtilityCalculator {
AppUtilityInit = CalcInit
AppUtilityDraw = CalcDraw
AppUtilityClick = CalcClick
AppUtilityKey = CalcKey
AppTitleLo = <AppTitle
AppTitleHi = >AppTitle
AppTitle: !tx "CALCULATOR",0
   !src "source/GeosAppCalculator.s"
}
!ifdef GeosUtilityText {
AppUtilityInit = TextInit
AppUtilityDraw = TextDraw
AppUtilityClick = TextClick
AppUtilityKey = TextKey
AppTitleLo = <AppTitle
AppTitleHi = >AppTitle
AppTitle: !tx "TEXT VIEWER",0
   !src "source/GeosAppText.s"
}

AppJoyKeys: !byte ChrCRSRUp,ChrCRSRDn,ChrCRSRLeft,ChrCRSRRight,ChrReturn
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

!src "source/GeosAppHelpers.s"

GeosUtilityEnd:
!if GeosUtilityEnd > $d000 {
   !error "Desktop utility exceeds reserved $c000-$cfff RAM"
}
