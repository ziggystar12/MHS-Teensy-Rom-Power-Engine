; The RTC remains UTC in Teensy. CIA TOD and the analog face show local time.
; All rendering/line state is absolute RAM, separate from SID zero page.
AppEnter:
   cld
   jsr ClockInit
   jsr ClockDraw
ClockLoop:
   jsr GeosRichClock
   jsr ClockRefresh
   jsr GetIn
   beq +
   jsr ClockKey
+  lda Joystick2Sample
   cmp ClockJoyLast
   beq ClockMouse
   sta ClockJoyLast
   ldx #0
-  lsr
   bcc +
   inx
   cpx #5
   bne -
   beq ClockMouse
+  lda ClockJoyKeys,x
   jsr ClockKey
ClockMouse:
   php
   sei
   lda MouseLogicalX
   sta MouseFrameX
   lda MouseLogicalY
   sta MouseFrameY
   lda MouseClickEdge
   sta ClockClickEdge
   lda #0
   sta MouseClickEdge
   plp
   lda MouseActive
   beq +
   lda #1
   sta MouseMenuEnabled
   jsr Mouse1351ShowPointer
   lda ClockClickEdge
   beq +
   jsr ClockClick
+  lda ClockExit
   beq ClockLoop
   lda #0
   sta MouseClickEdge
   sta MouseOpenArmed
   sta GeosMouseWasDown
   sta GeosDragActive
   sta BrowserDragging
   lda #$ff
   sta GeosDragCandidate
   lda #1
   rts

ClockInit:
   lda #0
   sta ClockSelection
   sta ClockExit
   sta ClockStatus
   sta MouseClickEdge
   sta MouseOpenArmed
   lda #1
   sta GeosBitmapActive
   lda #$ff
   sta ClockLastSecond
   sta ClockJoyLast
   rts

ClockKey:
   cmp #27
   beq ClockClose
   cmp #ChrStop
   beq ClockClose
   cmp #ChrHome
   beq ClockClose
   cmp #ChrF8
   beq ClockClose
   cmp #ChrReturn
   beq ClockActivate
   cmp #ChrRun
   beq ClockActivate
   cmp #ChrCRSRUp
   beq ClockPrevious
   cmp #ChrCRSRLeft
   beq ClockPrevious
   cmp #ChrCRSRDn
   beq ClockNext
   cmp #ChrCRSRRight
   beq ClockNext
   rts
ClockClose:
   lda #1
   sta ClockExit
   rts
ClockPrevious:
   lda ClockSelection
   bne +
   lda #12
+  sec
   sbc #1
   bcs ClockSelect
ClockNext:
   lda ClockSelection
   clc
   adc #1
   cmp #12
   bcc ClockSelect
   lda #0
ClockSelect:
   sta ClockSelection
   jmp ClockDraw

ClockClick:
   lda #<ClockWindow
   ldy #>ClockWindow
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcs ClockClose
   lda #0
   sta ClockIndex
-  jsr ClockLoadButton
   jsr UiHit
   bcc +
   lda ClockIndex
   sta ClockSelection
   jmp ClockActivate
+  inc ClockIndex
   lda ClockIndex
   cmp #12
   bne -
   rts

ClockActivate:
   lda AppBackendAvailable
   bne +
   rts
+  ldx ClockSelection
   cpx #2
   bcs ClockCheckTimezone
   lda rwRegPwrUpDefaults+IO1Port
   and #$ff-rpudClock12_24hr
   cpx #0
   beq +
   ora #rpudClock12_24hr
+  sta rwRegPwrUpDefaults+IO1Port
   and #rpudClock12_24hr
   sta smc24HourClockDisp+1
ClockSaved:
   jsr ClockWait
   jmp ClockDraw
ClockCheckTimezone:
   cpx #4
   bcs ClockCheckAdjust
   lda rwRegTimezone+IO1Port
   cpx #2
   bne ClockTimezoneUp
   sec
   sbc #1
   cmp #$e7
   bne ClockTimezoneSave
   lda #28
   bne ClockTimezoneSave
ClockTimezoneUp:
   clc
   adc #1
   cmp #29
   bne ClockTimezoneSave
   lda #$e8
ClockTimezoneSave:
   sta rwRegTimezone+IO1Port
   jsr ClockWait
   jmp ClockReloadTOD
ClockCheckAdjust:
   cpx #10
   bcs ClockCheckSync
   lda ClockAdjustCommands-4,x
   jsr ClockCommand
   jsr ClockInstallTOD
   jmp ClockDraw
ClockCheckSync:
   cpx #11
   beq ClockToggleStartup
   ldx #ClockSyncingEnd-ClockSyncing-1
-  lda ClockSyncing,x
   sta ClockStatus,x
   dex
   bpl -
   jsr ClockDraw
   lda #rCtlSetRTCfromNetWAIT
   jsr ClockCommand
ClockReloadTOD:
   lda #rCtlC64TODfromRTCWAIT
   jsr ClockCommand
   jsr ClockInstallTOD
   jmp ClockDraw
ClockToggleStartup:
   lda rwRegPwrUpDefaults+IO1Port
   eor #rpudNetTimeMask
   sta rwRegPwrUpDefaults+IO1Port
   jmp ClockSaved

ClockCommand:
   sta wRegControl+IO1Port
ClockWait:
   ; Network operations exchange several messages. Drain each to its NUL and
   ; acknowledge it before awaiting Ready; keep the last result for the GUI.
ClockWaitPoll:
   jsr GeosRichClock
   jsr ClockRefresh
   jsr Mouse1351ShowPointer
   lda rwRegStatus+IO1Port
   cmp #rsReady
   beq ClockWaitStable
   cmp #rsC64Message
   bne ClockWaitPoll
ClockWaitStable:
   ldx #5
-  cmp rwRegStatus+IO1Port
   bne ClockWaitPoll
   dex
   bne -
   cmp #rsReady
   beq ClockWaitDone
   lda #rsstSerialStringBuf
   sta rwRegSerialString+IO1Port
   ldx #0
ClockWaitDrain:
   lda rwRegSerialString+IO1Port
   beq ClockWaitMessageEnd
   cpx #32
   bcs ClockWaitDrain
   cmp #32
   bcs ClockWaitDecode
   lda #32
   bne ClockWaitStore
ClockWaitDecode:
   jsr BrowserPETSCIIToASCII ; inverse of the backend's display-wire table
ClockWaitStore:
   sta ClockStatus,x
   inx
   bne ClockWaitDrain
ClockWaitMessageEnd:
   lda #0
   sta ClockStatus,x
   lda #rsContinue
   sta rwRegStatus+IO1Port
   jmp ClockWaitPoll
ClockWaitDone:
   rts
ClockInstallTOD:
   lda rRegLastHourBCD+IO1Port
   sta TODHoursBCD
   lda rRegLastMinBCD+IO1Port
   sta TODMinBCD
   lda rRegLastSecBCD+IO1Port
   sta TODSecBCD
   lda #9
   sta TODTenthSecBCD
   rts

ClockDraw:
   jsr GeosRichBegin
   lda #>(GeosLayoutScreen-C64ScreenRAM)
   sta GeosBitmapColorOffset
   jsr GeosBitmapTintSurface
   lda #0
   tax
   jsr RichClearCanvas
   ldx #40
   ldy #192
   jsr ClockPosition
   lda #<ClockHelp
   ldy #>ClockHelp
   jsr RichText
   lda #<ClockWindow
   ldy #>ClockWindow
   jsr UiLoadRect
   jsr UiWindow
   ldx #24
   ldy #85
   jsr ClockPosition
   lda #<ClockTitle
   ldy #>ClockTitle
   jsr RichText
   ldx #32
   ldy #107
   jsr ClockPosition
   lda #<ClockFormat
   ldy #>ClockFormat
   jsr RichText
   ldx #32
   ldy #127
   jsr ClockPosition
   lda #<ClockTimezone
   ldy #>ClockTimezone
   jsr RichText
   ldx #64
   ldy #142
   jsr ClockPosition
   lda #<ClockHours
   ldy #>ClockHours
   jsr RichText
   ldx #148
   ldy #142
   jsr ClockPosition
   lda #<ClockMinutes
   ldy #>ClockMinutes
   jsr RichText
   ldx #234
   ldy #142
   jsr ClockPosition
   lda #<ClockSeconds
   ldy #>ClockSeconds
   jsr RichText
   lda #0
   sta ClockIndex
ClockDrawButtonLoop:
   jsr ClockLoadButton
   lda ClockIndex
   cmp ClockSelection
   beq +
   lda #0
   beq ++
+  lda #1
++ jsr UiButton
   lda RichX
   clc
   adc #6
   sta RichX
   lda RichY
   clc
   adc #5
   sta RichY
   ldx ClockIndex
   lda ClockLabelLo,x
   ldy ClockLabelHi,x
   jsr RichText
   lda ClockIndex
   cmp #11
   bne +
   lda rwRegPwrUpDefaults+IO1Port
   and #rpudNetTimeMask
   beq ClockStartupOff
   lda #<ClockOn
   ldy #>ClockOn
   bne ClockStartupText
ClockStartupOff:
   lda #<ClockOff
   ldy #>ClockOff
ClockStartupText:
   jsr RichText
+  inc ClockIndex
   lda ClockIndex
   cmp #12
   bne ClockDrawButtonLoop
   ; A small marker beneath the active format remains visible as focus moves.
   ldx #124
   lda rwRegPwrUpDefaults+IO1Port
   and #rpudClock12_24hr
   beq +
   ldx #172
+  ldy #119
   jsr ClockPosition
   lda #24
   sta RichW
   lda #1
   sta RichH
   jsr RichRect
   ldx #146
   ldy #127
   jsr ClockPosition
   ldx #'+'
   lda rwRegTimezone+IO1Port
   bpl +
   eor #$ff
   clc
   adc #1
   ldx #'-'
+  sta ClockTemp
   txa
   jsr RichChar
   lda ClockTemp
   lsr
   jsr ClockDecimal
   lda #':'
   jsr RichChar
   lda ClockTemp
   and #1
   beq +
   lda #$30
+  jsr RichHexByte
   jsr RichClockSnapshot
   ldx #72
   ldy #156
   jsr ClockPosition
   jsr ClockHourValue
   jsr RichHexByte
   ldx #158
   ldy #156
   jsr ClockPosition
   lda RichClockMinute
   jsr RichHexByte
   ldx #244
   ldy #156
   jsr ClockPosition
   lda RichClockSecond
   jsr RichHexByte
   lda #<ClockNetworkRect
   ldy #>ClockNetworkRect
   jsr UiLoadRect
   jsr UiFrame
   ldx #202
   ldy #24
   jsr ClockPosition
   lda #<ClockNetwork
   ldy #>ClockNetwork
   jsr RichText
   ldx #0
ClockStatusLoop:
   stx ClockIndex
   cpx #0
   beq ClockStatusFirstLine
   cpx #17
   bne +
   ldy #48
   bne ClockStatusPosition
ClockStatusFirstLine:
   ldy #38
ClockStatusPosition:
   ldx #202
   jsr ClockPosition
+  ldx ClockIndex
   lda ClockStatus,x
   beq ClockStatusDone
   jsr RichChar
   ldx ClockIndex
   inx
   cpx #32
   bne ClockStatusLoop
ClockStatusDone:
   jsr ClockDrawLocal
   jsr ClockDrawFace
   jsr GeosRichPublish
   jsr GeosBitmapPublishColors
ClockRestoreBank:
   lda RichSavedBank
   sta $01
   rts

ClockPosition:
   stx RichX
   sty RichY
   lda #0
   sta RichXHi
   sta RichWHi
   lda #$ff
   sta RichInk
   rts
ClockDecimal:
   ldx #'0'
-  cmp #10
   bcc +
   sbc #10
   inx
   bne -
+  pha
   txa
   jsr RichChar
   pla
   ora #'0'
   jmp RichChar
ClockLoadButton:
   lda ClockIndex
   asl
   sta ClockTemp
   asl
   clc
   adc ClockTemp
   adc #<ClockButtons
   ldy #>ClockButtons
   bcc +
   iny
+  jmp UiLoadRect

ClockRefresh:
   jsr RichClockSnapshot
   lda RichClockSecond
   cmp ClockLastSecond
   bne +
   lda RichClockMinute
   cmp ClockLastMinute
   bne +
   lda RichClockHour
   cmp ClockLastHour
   bne +
   rts
+  ; Seconds and all three adjustment readouts change together. Drawing is
   ; staged, then only the face and numeric fields are copied to the display.
   jsr GeosRichBegin
   jsr ClockDrawFace
   lda #<ClockFaceRect
   ldy #>ClockFaceRect
   jsr UiLoadRect
   jsr UiPublishRect
   ; Draw only the six numeric glyphs in the control body.
   lda #0
   sta ClockIndex
ClockRefreshNumber:
   ldx ClockIndex
   lda ClockNumberX,x
   tax
   ldy #156
   jsr ClockPosition
   lda #12
   sta RichW
   lda #7
   sta RichH
   lda #0
   sta RichInk
   jsr RichRect
   lda #$ff
   sta RichInk
   ldx ClockIndex
   lda RichClockHour,x
   cpx #0
   bne +
   jsr ClockHourValue
+  jsr RichHexByte
   ldx ClockIndex
   lda ClockNumberX,x
   sta RichX
   lda #12
   sta RichW
   lda #7
   sta RichH
   jsr UiPublishRect
   inc ClockIndex
   lda ClockIndex
   cmp #3
   bne ClockRefreshNumber
   jsr ClockDrawLocal
   lda #<ClockLocalRect
   ldy #>ClockLocalRect
   jsr UiLoadRect
   jsr UiPublishRect
   jmp ClockRestoreBank

; BCD hour formatting without decimal mode, so SID interrupt state is intact.
ClockHourValue:
   lda RichClockHour
   and #$1f
   cmp #$12
   bne +
   lda #0
+  sta ClockHourTemp
   lda smc24HourClockDisp+1
   beq ClockHour12
   lda ClockHourTemp
   bit RichClockHour
   bpl ClockHourDone
   clc
   adc #$12
   sta ClockHourTemp
   and #15
   cmp #10
   lda ClockHourTemp
   bcc ClockHourDone
   clc
   adc #6
ClockHourDone:
   rts
ClockHour12:
   lda ClockHourTemp
   bne ClockHourDone
   lda #$12
   rts
ClockDrawLocal:
   lda #<ClockLocalRect
   ldy #>ClockLocalRect
   jsr UiLoadRect
   jsr UiFrame
   ldx #30
   ldy #26
   jsr ClockPosition
   lda #<ClockLocalTitle
   ldy #>ClockLocalTitle
   jsr RichText
   ldx #36
   ldy #39
   jsr ClockPosition
   jsr ClockHourValue
   jsr RichHexByte
   lda #':'
   jsr RichChar
   lda RichClockMinute
   jsr RichHexByte
   lda #':'
   jsr RichChar
   lda RichClockSecond
   jsr RichHexByte
   ldx #42
   ldy #53
   jsr ClockPosition
   lda smc24HourClockDisp+1
   beq +
   lda #<Clock24Caption
   ldy #>Clock24Caption
   jmp RichText
+  lda #'A'
   bit RichClockHour
   bpl +
   lda #'P'
+  and #$7f
   jsr RichChar
   lda #'M'
   and #$7f
   jmp RichChar

ClockDrawFace:
   lda RichClockSecond
   sta ClockLastSecond
   lda RichClockMinute
   sta ClockLastMinute
   lda RichClockHour
   sta ClockLastHour
   lda #<ClockFaceRect
   ldy #>ClockFaceRect
   jsr UiLoadRect
   jsr UiFrame
   lda #0
   sta RichInk
   jsr RichRect
   lda #<ClockFaceArt
   sta RichSource+1
   lda #>ClockFaceArt
   sta RichSource+2
   lda #8
   sta RichBytes
   lda #64
   sta RichH
   lda #$ff
   sta RichInk
   jsr RichBlit
   lda RichClockHour
   and #$1f
   jsr ClockBCD
   cmp #12
   bcc +
   lda #0
+  sta ClockTemp
   asl
   asl
   clc
   adc ClockTemp
   sta ClockHourIndex
   lda RichClockMinute
   jsr ClockBCD
-  cmp #12
   bcc +
   sbc #12
   inc ClockHourIndex
   bne -
+  ldx ClockHourIndex
   lda ClockHourX,x
   sta ClockEndX
   lda ClockHourY,x
   sta ClockEndY
   lda #2
   sta ClockLineWidth
   jsr ClockLine
   lda RichClockMinute
   jsr ClockBCD
   tax
   lda ClockMinuteX,x
   sta ClockEndX
   lda ClockMinuteY,x
   sta ClockEndY
   jsr ClockLine
   lda RichClockSecond
   jsr ClockBCD
   tax
   lda ClockSecondX,x
   sta ClockEndX
   lda ClockSecondY,x
   sta ClockEndY
   lda #1
   sta ClockLineWidth
   jsr ClockLine
   ldx #158
   ldy #42
   jsr ClockPosition
   lda #5
   sta RichW
   sta RichH
   jmp RichRect
ClockBCD:
   sta ClockBCDTemp
   and #$f0
   lsr
   sta ClockBCDHalf
   lsr
   lsr
   clc
   adc ClockBCDHalf
   sta ClockBCDHalf
   lda ClockBCDTemp
   and #15
   clc
   adc ClockBCDHalf
   rts

; Integer Bresenham line. Biased comparisons avoid signed branch overflow.
ClockLine:
   lda #160
   sta ClockLineX
   lda #44
   sta ClockLineY
   lda #1
   sta ClockStepX
   sta ClockStepY
   lda ClockEndX
   sec
   sbc #160
   bcs +
   eor #$ff
   adc #1
   dec ClockStepX
   dec ClockStepX
+  sta ClockDX
   lda ClockEndY
   sec
   sbc #44
   bcs +
   eor #$ff
   adc #1
   dec ClockStepY
   dec ClockStepY
+  sta ClockDY
   lda ClockDX
   sec
   sbc ClockDY
   sta ClockError
ClockLinePlot:
   ldx ClockLineX
   ldy ClockLineY
   jsr ClockPosition
   lda ClockLineWidth
   sta RichW
   sta RichH
   jsr RichRect
   lda ClockLineX
   cmp ClockEndX
   bne +
   lda ClockLineY
   cmp ClockEndY
   beq ClockLineDone
+  lda ClockError
   asl
   eor #$80
   sta ClockError2
   lda #0
   sec
   sbc ClockDY
   eor #$80
   cmp ClockError2
   bcs +
   lda ClockError
   sec
   sbc ClockDY
   sta ClockError
   lda ClockLineX
   clc
   adc ClockStepX
   sta ClockLineX
+  lda ClockDX
   eor #$80
   cmp ClockError2
   beq ClockLinePlot
   bcc ClockLinePlot
   lda ClockError
   clc
   adc ClockDX
   sta ClockError
   lda ClockLineY
   clc
   adc ClockStepY
   sta ClockLineY
   jmp ClockLinePlot
ClockLineDone:
   rts

ClockWindow: !byte 16,0,81,32,1,110
ClockFaceRect: !byte 128,0,12,64,0,64
ClockLocalRect: !byte 16,0,20,96,0,48
ClockNetworkRect: !byte 196,0,18,116,0,46
ClockButtons:
   !byte 116,0,102,40,0,16, 164,0,102,40,0,16
   !byte 116,0,122,20,0,16, 220,0,122,20,0,16
   !byte 40,0,151,20,0,16, 96,0,151,20,0,16
   !byte 126,0,151,20,0,16, 182,0,151,20,0,16
   !byte 212,0,151,20,0,16, 12,1,151,20,0,16
   !byte 28,0,172,132,0,16, 176,0,172,112,0,16
ClockLabelLo: !byte <Clock12,<Clock24,<ClockMinus,<ClockPlus,<ClockMinus,<ClockPlus,<ClockMinus,<ClockPlus,<ClockMinus,<ClockPlus,<ClockSync,<ClockStartup
ClockLabelHi: !byte >Clock12,>Clock24,>ClockMinus,>ClockPlus,>ClockMinus,>ClockPlus,>ClockMinus,>ClockPlus,>ClockMinus,>ClockPlus,>ClockSync,>ClockStartup
ClockAdjustCommands: !byte rCtlRTCAdj_Hrs_Dn_WAIT,rCtlRTCAdj_Hrs_Up_WAIT,rCtlRTCAdj_Min_Dn_WAIT,rCtlRTCAdj_Min_Up_WAIT,rCtlRTCAdj_Sec_Dn_WAIT,rCtlRTCAdj_Sec_Up_WAIT
ClockNumberX: !byte 72,158,244
ClockJoyKeys: !byte ChrCRSRUp,ChrCRSRDn,ChrCRSRLeft,ChrCRSRRight,ChrReturn
ClockTitle: !tx "CLOCK SETTINGS",0
ClockHelp: !tx "ARROWS SELECT  RETURN APPLIES  ESC CLOSES",0
ClockFormat: !tx "FORMAT",0
ClockTimezone: !tx "UTC OFFSET",0
ClockHours: !tx "HOUR",0
ClockMinutes: !tx "MIN",0
ClockSeconds: !tx "SEC",0
ClockNetwork: !tx "NETWORK RESULT",0
ClockLocalTitle: !tx "LOCAL TIME",0
Clock24Caption: !tx "24 HOUR",0
Clock12: !tx "12 H",0
Clock24: !tx "24 H",0
ClockMinus: !tx "-",0
ClockPlus: !tx "+",0
ClockSync: !tx "SYNC VIA ETHERNET",0
ClockStartup: !tx "STARTUP ",0
ClockOn: !tx "ON",0
ClockOff: !tx "OFF",0
ClockSyncing: !tx "SYNCING...",0
ClockSyncingEnd:
ClockSelection: !byte 0
ClockIndex: !byte 0
ClockExit: !byte 0
ClockClickEdge: !byte 0
ClockJoyLast: !byte 0
ClockLastSecond: !byte 0
ClockLastMinute: !byte 0
ClockLastHour: !byte 0
ClockTemp: !byte 0
ClockBCDTemp: !byte 0
ClockBCDHalf: !byte 0
ClockHourIndex: !byte 0
ClockHourTemp: !byte 0
ClockEndX: !byte 0
ClockEndY: !byte 0
ClockLineX: !byte 0
ClockLineY: !byte 0
ClockStepX: !byte 0
ClockStepY: !byte 0
ClockDX: !byte 0
ClockDY: !byte 0
ClockError: !byte 0
ClockError2: !byte 0
ClockLineWidth: !byte 0
ClockStatus: !fill 33,0
!src "source/GeosClockArt.s"
