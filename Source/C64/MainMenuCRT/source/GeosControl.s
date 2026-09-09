; Native settings categories and background music share one modal icon window.
; Mode is the table offset: zero for nine settings, nine for five music actions.
GeosControlPublish = $c00a
GeosMusicOpen:
   lda #9
   sta GeosControlMode
   jsr GeosMusicReadName
   jmp GeosControlOpen

GeosControlIndex:
   lda RichItem
   clc
   adc GeosControlMode
   tax
   rts
GeosControlCount:
   lda #9
   ldx GeosControlMode
   beq +
   lda #5
+  rts
GeosControlOrigin:
   jsr GeosControlIndex
   lda GeosControlX,x
   sta RichX
   lda GeosControlY,x
   sta RichY
   lda #0
   sta RichXHi
   sta RichWHi
   rts

GeosControlDraw:
   lda #<UiControlWindow
   ldy #>UiControlWindow
   jsr UiLoadRect
   jsr UiWindow
   lda #0
   sta RichXHi
   lda #20
   sta RichY
   lda #$ff
   sta RichInk
   lda #121
   sta RichX
   lda GeosControlMode
   beq +
   lda #145
   sta RichX
   lda #<MsgControlMusic
   ldy #>MsgControlMusic
   bne ++
+  lda #<RichControlTitle
   ldy #>RichControlTitle
++ jsr RichText
   lda #0
   sta RichItem
GeosControlDrawItem:
   jsr GeosControlOrigin
   lda GeosControlArt,x
   tax
   lda RichIconLo,x
   sta RichSource+1
   lda RichIconHi,x
   sta RichSource+2
   lda #3
   sta RichBytes
   lda #16
   sta RichH
   lda #$ff
   sta RichInk
   jsr RichBlit
   jsr GeosControlLabel
   inc RichItem
   jsr GeosControlCount
   cmp RichItem
   bne GeosControlDrawItem
   lda GeosControlMode
   beq +
   jmp GeosMusicCaption
+
   lda #58
   sta RichX
   lda #171
   sta RichY
   lda #$ff
   sta RichInk
   lda #<RichControlHelp
   ldy #>RichControlHelp
   jmp RichText

GeosControlLabel:
   jsr GeosControlOrigin
   lda RichX
   sec
   sbc #24
   sta RichX
   lda RichY
   clc
   adc #19
   sta RichY
   lda #72
   sta RichW
   lda #9
   sta RichH
   lda #0
   sta RichInk
   lda RichItem
   cmp GeosControlSelection
   bne +
   lda #$ff
   sta RichInk
+  jsr RichRect
   lda RichInk
   eor #$ff
   sta RichInk
   inc RichY
   jsr GeosControlIndex
   lda GeosControlTextLength,x
   sta RichLength
   asl
   clc
   adc RichLength
   sta RichHalfWidth
   lda GeosControlX,x
   clc
   adc #12
   sec
   sbc RichHalfWidth
   sta RichX
   txa
   asl
   tax
   lda TblGeosControlLabel,x
   ldy TblGeosControlLabel+1,x
   jmp RichText

; Pixel hit boxes are the painted 24x16 icon, its 72x9 label plate, or X.
GeosControlHitTest:
   lda #<UiControlWindow
   ldy #>UiControlWindow
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcc +
   lda #$ff
   sec
   rts
+  lda #0
   sta RichItem
GeosControlHitItem:
   jsr GeosControlOrigin
   lda #24
   sta RichW
   lda #16
   sta RichH
   jsr RichHitRect
   bcs GeosControlHitFound
   lda RichX
   sec
   sbc #24
   sta RichX
   lda RichY
   clc
   adc #19
   sta RichY
   lda #72
   sta RichW
   lda #9
   sta RichH
   jsr RichHitRect
   bcs GeosControlHitFound
   inc RichItem
   jsr GeosControlCount
   cmp RichItem
   bne GeosControlHitItem
   clc
   rts
GeosControlHitFound:
   lda RichItem
   sec
   rts

GeosControlItemUp:
   ldy #0
   beq GeosControlMove
GeosControlItemDown:
   ldy #14
   bne GeosControlMove
GeosControlItemLeft:
   ldy #28
   bne GeosControlMove
GeosControlItemRight:
   ldy #42
GeosControlMove:
   tya
   clc
   adc GeosControlMode
   adc GeosControlSelection
   tax
   lda GeosControlMoves,x
   ldx #0
   stx MouseOpenArmed
GeosControlSetSelection:
   cmp GeosControlSelection
   beq GeosControlSelected
   ldx GeosControlSelection
   stx GeosControlOld
   sta GeosControlSelection
   jsr GeosRichBegin
   lda GeosControlOld
   sta RichItem
   jsr GeosControlLabel
   jsr GeosControlPublish
   lda GeosControlSelection
   sta RichItem
   jsr GeosControlLabel
   jsr GeosControlPublish
   lda RichSavedBank
   sta $01
GeosControlSelected:
   sec
   rts

GeosControlHandleKey:
   cmp #ChrF1
   bne +
   lda #0
   sta GeosOverlayMode
   jsr TagTRHelp
   sec
   rts
+  cmp #ChrF6
   bne +
   jsr GeosMusicOpen
   sec
   rts
+
   cmp #ChrCRSRUp
   beq GeosControlItemUp
   cmp #ChrCRSRDn
   beq GeosControlItemDown
   cmp #ChrCRSRLeft
   beq GeosControlItemLeft
   cmp #ChrCRSRRight
   beq GeosControlItemRight
   cmp #ChrReturn
   beq GeosControlActivateKey
   cmp #ChrRun
   beq GeosControlActivateKey
   cmp #ChrHome
   beq GeosControlCloseKey
   cmp #ChrStop
   beq GeosControlCloseKey
   cmp #27
   beq GeosControlCloseKey
   cmp #ChrF8
   beq GeosControlCloseKey
   sec
   rts
GeosControlActivateKey:
   jsr GeosShellLaunchControlPage
   sec
   rts
GeosControlCloseKey:
   jsr GeosMouseCloseOverlay
   sec
   rts

GeosMusicActivate:
   lda GeosControlSelection
   beq GeosMusicBrowse
   cmp #1
   bne +
   jsr ToggleSIDMusic
   jmp GeosMusicRefreshStartup
+  cmp #2
   bne +
   lda #rCtlSetBackgroundSIDWAIT
   sta wRegControl+IO1Port
   jmp GeosMusicWait
+  cmp #4
   bne +
   jsr ShowSIDAdvancedPage
   jmp GeosMusicOpen
+  lda rwRegPwrUpDefaults+IO1Port
   eor #rpudSIDPauseMask
   sta rwRegPwrUpDefaults+IO1Port
GeosMusicWait:
   jsr WaitForTRWaitMsg
GeosControlRepaint:
   jsr GeosRichBegin
   jsr GeosControlDraw
   jsr GeosRichPublish
   jsr GeosBitmapPublishColors
   jmp GeosDialogRestoreBank
GeosMusicBrowse:
   lda #GeosSurfaceBrowser
   sta GeosSurfaceMode
   lda #0
   sta GeosOverlayMode
   sta MouseOpenArmed
   jmp GeosShellRedraw

; SID info starts CR, space, filename, CR. Capture only its first line and
; drain the rest. Fixed storage keeps drawing independent of backend reads.
GeosMusicReadName:
   lda #rsstSIDInfo
   sta rwRegSerialString+IO1Port
   lda rwRegSerialString+IO1Port
   lda rwRegSerialString+IO1Port
   ldx #0
GeosMusicNameRead:
   lda rwRegSerialString+IO1Port
   beq GeosMusicNameDone
   cmp #13
   beq GeosMusicNameDrain
   cpx #38
   bcs GeosMusicNameRead
   jsr BrowserPETSCIIToASCII
   sta GeosMusicName,x
   inx
   bne GeosMusicNameRead
GeosMusicNameDrain:
   lda rwRegSerialString+IO1Port
   bne GeosMusicNameDrain
GeosMusicNameDone:
   lda #0
   sta GeosMusicName,x
   rts

GeosMusicCaption:
   lda #46
   sta RichX
   lda #124
   sta RichY
   lda #$ff
   sta RichInk
   lda #<GeosMusicName
   ldy #>GeosMusicName
   jsr RichText
   jsr GeosMusicStartupCaption
   lda #58
   sta RichX
   lda #164
   sta RichY
   lda #<MsgMusicHelp
   ldy #>MsgMusicHelp
   jmp RichText

; Play/pause changes only the saved-startup caption. Clear its old final F
; when going from OFF to ON, then publish this strip without redrawing icons.
GeosMusicRefreshStartup:
   jsr GeosRichBegin
   lda #<GeosMusicStartupRect
   ldy #>GeosMusicStartupRect
   jsr UiLoadRect
   lda #0
   sta RichInk
   jsr RichRect
   lda #$ff
   sta RichInk
   jsr GeosMusicStartupCaption
   lda #<GeosMusicStartupRect
   ldy #>GeosMusicStartupRect
   jsr UiLoadRect
   jsr UiPublishRect
   jmp GeosDialogRestoreBank
GeosMusicStartupRect: !byte 58,0,144,108,0,7

GeosMusicStartupCaption:
   lda #58
   sta RichX
   lda #144
   sta RichY
   lda #<MsgMusicAutoplayOff
   ldy #>MsgMusicAutoplayOff
   ldx rwRegPwrUpDefaults+IO1Port
   txa
   and #rpudSIDPauseMask
   bne +
   lda #<MsgMusicAutoplayOn
   ldy #>MsgMusicAutoplayOn
   bne ++
+  lda #<MsgMusicAutoplayOff
++ jmp RichText

TblGeosControlLabel:
   !word MsgControlAppearance,MsgControlInput,MsgControlStartup,MsgControlStorage
   !word MsgControlClock,MsgControlMidiNet,MsgControlSystem,MsgControlAdvanced
   !word MsgControlMusic
   !word MsgMusicBrowse,MsgMusicPlay,MsgMusicDefault,MsgMusicAutoplay,MsgControlAdvanced
GeosControlX: !byte 64,144,224,64,144,224,64,144,224,64,144,224,104,184
GeosControlY: !byte 40,40,40,84,84,84,128,128,128,40,40,40,84,84
GeosControlArt: !byte 7,0,6,1,7,2,0,6,7,5,0,1,7,6
GeosControlTextLength: !byte 10,5,7,7,5,8,6,8,5,6,10,11,8,8
GeosControlMoves:
   !byte 6,7,8,0,1,2,3,4,5, 3,4,2,0,1
   !byte 3,4,5,6,7,8,0,1,2, 3,4,2,0,1
   !byte 2,0,1,5,3,4,8,6,7, 2,0,1,4,3
   !byte 1,2,0,4,5,3,7,8,6, 1,2,0,4,3
MsgMusicBrowse: !tx "BROWSE",0
MsgMusicPlay: !tx "PLAY/PAUSE",0
MsgMusicDefault: !tx "USE DEFAULT",0
MsgMusicAutoplay: !tx "AUTOPLAY",0
MsgMusicAutoplayOn: !tx "STARTUP MUSIC: ON",0
MsgMusicAutoplayOff: !tx "STARTUP MUSIC: OFF",0
MsgMusicHelp: !tx "OPEN A SID, THEN USE DEFAULT",0

UiControlWindow: !byte 40,0,16,240,0,168
