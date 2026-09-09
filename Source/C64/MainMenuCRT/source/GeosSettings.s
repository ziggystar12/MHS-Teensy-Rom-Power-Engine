; Native Appearance, Input and Storage panels. They execute from the low-RAM
; settings overlay and keep the desktop renderer, IRQ mouse sampler and SID
; service resident. A/Y/X and the renderer's shared scratch are caller-owned.

SettingsPageAppearance = 0
SettingsPageInput = 1
SettingsPageStorage = 3

GeosSettingsOpen:
   sta SettingsPage
   lda #0
   sta SettingsSelection
   sta SettingsDropdown
   sta SettingsExit
   sta MouseOpenArmed
   lda #$ff
   sta SettingsJoyLast
   lda SettingsPage
   cmp #SettingsPageStorage
   bne +
   jsr SettingsStorageRefresh
+  jsr SettingsDraw

SettingsLoop:
   jsr DisplayTime
   jsr Mouse1351SelectConfiguredPots
   jsr SettingsMousePoll
   jsr GetIn
   bne SettingsGotKey
   jsr SettingsJoystickPoll
   bcc SettingsLoopCheckExit
SettingsGotKey:
   jsr SettingsHandleKey
SettingsLoopCheckExit:
   lda SettingsExit
   beq SettingsLoop
   lda #0
   sta MouseClickEdge
   sta MouseOpenArmed
   sta SettingsDropdown
   rts

; Snapshot mouse state once, retain the normal sprite pointer, and consume one
; click edge locally so it cannot leak back into the category window.
SettingsMousePoll:
   lda MouseActive
   beq SettingsMouseNone
   lda #1
   sta MouseMenuEnabled
   php
   sei
   lda MouseLogicalX
   sta MouseFrameX
   lda MouseLogicalY
   sta MouseFrameY
   lda MouseClickEdge
   sta SettingsClick
   lda #0
   sta MouseClickEdge
   plp
   jsr Mouse1351ShowPointer
   lda SettingsClick
   beq SettingsMouseNone
   jsr SettingsMouseClick
SettingsMouseNone:
   rts

; One action per joystick press. In the two-joystick layout the sampler has
; already combined both active-low ports.
SettingsJoystickPoll:
   lda Joystick2Sample
   cmp SettingsJoyLast
   beq SettingsNoJoy
   sta SettingsJoyLast
   ldx #0
-  lsr
   bcc +
   inx
   cpx #5
   bne -
SettingsNoJoy:
   clc
   rts
+  lda SettingsJoyKeys,x
   sec
   rts

SettingsHandleKey:
   cmp #ChrF1
   bne +
   jmp TagTRHelp
+  cmp #ChrStop
   beq SettingsCloseKey
   cmp #ChrHome
   beq SettingsCloseKey
   cmp #ChrF8
   beq SettingsCloseKey
   cmp #27
   beq SettingsEscapeKey
   ldx SettingsPage
   beq SettingsAppearanceKey
   cpx #SettingsPageInput
   bne +
   jmp SettingsInputKey
+
   jmp SettingsStorageKey
SettingsEscapeKey:
   lda SettingsDropdown
   beq SettingsCloseKey
   lda #0
   sta SettingsDropdown
   jmp SettingsDraw
SettingsCloseKey:
   lda #1
   sta SettingsExit
   rts

SettingsAppearanceKey:
   cmp #ChrCRSRUp
   beq SettingsAppearanceMove
   cmp #ChrCRSRDn
   beq SettingsAppearanceMove
   cmp #ChrCRSRLeft
   beq SettingsAppearancePrevious
   cmp #ChrCRSRRight
   beq SettingsAppearanceNext
   cmp #ChrReturn
   beq SettingsAppearanceNext
   cmp #ChrRun
   beq SettingsAppearanceNext
   rts
SettingsAppearanceMove:
   lda SettingsSelection
   eor #1
   sta SettingsSelection
   jmp SettingsDraw
SettingsAppearancePrevious:
   lda SettingsSelection
   beq SettingsAppearanceToggleMode
   lda GeosAppearancePrefs
   and #rpud3BackgroundMask
   beq SettingsAppearanceSetBlank
   cmp #rpud3BackgroundDithered
   beq SettingsAppearanceSetDots
   lda #rpud3BackgroundDithered
   bne SettingsAppearanceSetBackground
SettingsAppearanceNext:
   lda SettingsSelection
   beq SettingsAppearanceToggleMode
   lda GeosAppearancePrefs
   and #rpud3BackgroundMask
   beq SettingsAppearanceSetDithered
   cmp #rpud3BackgroundDithered
   beq SettingsAppearanceSetBlank
SettingsAppearanceSetDots:
   lda #rpud3BackgroundDots
   beq SettingsAppearanceSetBackground
SettingsAppearanceSetDithered:
   lda #rpud3BackgroundDithered
   bne SettingsAppearanceSetBackground
SettingsAppearanceSetBlank:
   lda #rpud3BackgroundBlank
SettingsAppearanceSetBackground:
   sta SettingsValue
   lda GeosAppearancePrefs
   and #$ff-rpud3BackgroundMask
   ora SettingsValue
   jmp SettingsAppearanceSave
SettingsAppearanceToggleMode:
   lda GeosAppearancePrefs
   eor #rpud3AppearanceDark
SettingsAppearanceSave:
   and #rpud3AppearanceDark+rpud3BackgroundMask
   sta GeosAppearancePrefs
   sta SettingsValue
   lda GeosAppBackendAvailable
   beq +
   lda rwRegPwrUpDefaults3+IO1Port
   and #$ff-(rpud3AppearanceDark+rpud3BackgroundMask)
   ora SettingsValue
   sta rwRegPwrUpDefaults3+IO1Port
   jsr WaitForTRWaitMsg
+  jmp SettingsDraw

SettingsInputKey:
   ldx SettingsDropdown
   beq SettingsInputClosedKey
   cmp #ChrCRSRUp
   beq SettingsInputToggleChoice
   cmp #ChrCRSRDn
   beq SettingsInputToggleChoice
   cmp #ChrCRSRLeft
   beq SettingsInputCancelDrop
   cmp #ChrReturn
   beq SettingsInputCommit
   cmp #ChrRun
   beq SettingsInputCommit
   rts
SettingsInputToggleChoice:
   lda SettingsDropChoice
   eor #1
   sta SettingsDropChoice
   jmp SettingsDraw
SettingsInputCancelDrop:
   lda #0
   sta SettingsDropdown
   jmp SettingsDraw
SettingsInputClosedKey:
   cmp #ChrCRSRUp
   beq SettingsInputMove
   cmp #ChrCRSRDn
   beq SettingsInputMove
   cmp #ChrCRSRLeft
   beq SettingsInputMove
   cmp #ChrCRSRRight
   beq SettingsInputMove
   cmp #ChrReturn
   beq SettingsInputOpenDrop
   cmp #ChrRun
   beq SettingsInputOpenDrop
   rts
SettingsInputMove:
   lda SettingsSelection
   eor #1
   sta SettingsSelection
   jmp SettingsDraw
SettingsInputOpenDrop:
   lda SettingsSelection
   clc
   adc #1
   sta SettingsDropdown
   jsr SettingsInputSelectedDevice
   sta SettingsDropChoice
   jmp SettingsDraw

; Choice zero is Mouse, one is Joystick. A mouse choice always moves the sole
; mouse to that port. Turning the current mouse into a joystick yields two
; joysticks; selecting an already-active joystick leaves the other port alone.
SettingsInputCommit:
   lda SettingsDropChoice
   bne SettingsInputCommitJoystick
   lda #rpud3InputMouse1Joy2
   ldx SettingsDropdown
   dex
   beq SettingsInputApply
   lda #rpud3InputJoy1Mouse2
   bne SettingsInputApply
SettingsInputCommitJoystick:
   jsr GeosInputGetLayout
   ldx SettingsDropdown
   dex
   beq SettingsInputJoyPort1
   cmp #rpud3InputJoy1Mouse2
   bne SettingsInputApplied
   lda #rpud3InputJoy1Joy2
   bne SettingsInputApply
SettingsInputJoyPort1:
   cmp #rpud3InputMouse1Joy2
   bne SettingsInputApplied
   lda #rpud3InputJoy1Joy2
SettingsInputApply:
   jsr GeosInputSetLayout
SettingsInputApplied:
   lda #0
   sta SettingsDropdown
   jmp SettingsDraw

; Return 0 Mouse / 1 Joystick for the currently selected port.
SettingsInputSelectedDevice:
   jsr GeosInputGetLayout
   ldx SettingsSelection
   bne SettingsInputDevicePort2
   cmp #rpud3InputMouse1Joy2
   beq SettingsInputDeviceMouse
SettingsInputDeviceJoystick:
   lda #1
   rts
SettingsInputDevicePort2:
   cmp #rpud3InputJoy1Mouse2
   bne SettingsInputDeviceJoystick
SettingsInputDeviceMouse:
   lda #0
   rts

SettingsStorageKey:
   cmp #ChrReturn
   beq SettingsStorageKeyRefresh
   cmp #ChrRun
   beq SettingsStorageKeyRefresh
   and #$7f
   cmp #'r'
   bne +
SettingsStorageKeyRefresh:
   jsr SettingsStorageRefresh
   jmp SettingsDraw
+  rts

SettingsStorageRefresh:
   lda GeosAppBackendAvailable
   beq +
   lda #rCtlStorageRefreshWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRWaitMsg
+  rts

; ---------------------------------------------------------------------------
; Drawing

SettingsDraw:
   jsr GeosRichBegin
   lda #>(GeosLayoutScreen-C64ScreenRAM)
   sta GeosBitmapColorOffset
   jsr GeosBitmapTintSurface
   jsr GeosRichHome
   lda #<SettingsWindowRect
   ldy #>SettingsWindowRect
   jsr UiLoadRect
   jsr UiWindow
   lda #24
   sta RichX
   lda #17
   sta RichY
   lda #0
   sta RichXHi
   lda #$ff
   sta RichInk
   ldx SettingsPage
   lda SettingsTitleLo,x
   ldy SettingsTitleHi,x
   jsr RichText
   lda SettingsPage
   bne +
   jsr SettingsDrawAppearance
   jmp SettingsDrawPublish
+
   cmp #SettingsPageInput
   bne +
   jsr SettingsDrawInput
   jmp SettingsDrawPublish
+
   jsr SettingsDrawStorage
   jmp SettingsDrawPublish

SettingsDrawAppearance:
   lda #40
   sta RichX
   lda #43
   sta RichY
   lda #<MsgSettingsMode
   ldy #>MsgSettingsMode
   jsr RichText
   lda #<SettingsLightRect
   ldy #>SettingsLightRect
   jsr UiLoadRect
   lda GeosAppearancePrefs
   and #rpud3AppearanceDark
   beq +
   lda #0
   beq ++
+
   lda #1
++
   jsr SettingsDrawButtonLight
   lda #<SettingsDarkRect
   ldy #>SettingsDarkRect
   jsr UiLoadRect
   lda GeosAppearancePrefs
   and #rpud3AppearanceDark
   beq +
   lda #1
+  jsr SettingsDrawButtonDark
   lda #40
   sta RichX
   lda #91
   sta RichY
   lda #<MsgSettingsBackground
   ldy #>MsgSettingsBackground
   jsr RichText
   lda GeosAppearancePrefs
   and #rpud3BackgroundMask
   sta SettingsValue
   lda #<SettingsDotsRect
   ldy #>SettingsDotsRect
   jsr UiLoadRect
   lda SettingsValue
   beq +
   lda #0
   beq ++
+
   lda #1
++
   jsr SettingsDrawButtonDots
   lda #<SettingsDitherRect
   ldy #>SettingsDitherRect
   jsr UiLoadRect
   lda SettingsValue
   cmp #rpud3BackgroundDithered
   bne +
   lda #1
   bne ++
+  lda #0
++ jsr SettingsDrawButtonDither
   lda #<SettingsBlankRect
   ldy #>SettingsBlankRect
   jsr UiLoadRect
   lda SettingsValue
   cmp #rpud3BackgroundBlank
   bne +
   lda #1
   bne ++
+  lda #0
++ jsr SettingsDrawButtonBlank
   lda #28
   sta RichX
   lda #63
   ldx SettingsSelection
   beq +
   lda #113
+  sta RichY
   lda #<MsgSettingsFocus
   ldy #>MsgSettingsFocus
   jsr RichText
   lda #<MsgAppearanceHelp
   ldy #>MsgAppearanceHelp
   jmp SettingsDrawFooter

SettingsDrawButtonLight:
   jsr UiButton
   lda RichX
   clc
   adc #20
   sta RichX
   lda RichY
   clc
   adc #6
   sta RichY
   lda #<MsgLight
   ldy #>MsgLight
   jmp RichText
SettingsDrawButtonDark:
   jsr UiButton
   lda RichX
   clc
   adc #22
   sta RichX
   lda RichY
   clc
   adc #6
   sta RichY
   lda #<MsgDark
   ldy #>MsgDark
   jmp RichText
SettingsDrawButtonDots:
   jsr UiButton
   lda RichX
   clc
   adc #17
   sta RichX
   lda RichY
   clc
   adc #6
   sta RichY
   lda #<MsgDots
   ldy #>MsgDots
   jmp RichText
SettingsDrawButtonDither:
   jsr UiButton
   lda RichX
   clc
   adc #24
   sta RichX
   lda RichY
   clc
   adc #6
   sta RichY
   lda #<MsgDithered
   ldy #>MsgDithered
   jmp RichText
SettingsDrawButtonBlank:
   jsr UiButton
   lda RichX
   clc
   adc #17
   sta RichX
   lda RichY
   clc
   adc #6
   sta RichY
   lda #<MsgBlank
   ldy #>MsgBlank
   jmp RichText

SettingsDrawInput:
   lda #48
   sta SettingsPortX
   ldx #0
   jsr SettingsDrawPort
   lda #184
   sta SettingsPortX
   ldx #1
   jsr SettingsDrawPort
   lda #<SettingsPort1Field
   ldy #>SettingsPort1Field
   jsr UiLoadRect
   lda SettingsSelection
   eor #1
   jsr SettingsDrawInputField
   lda #<SettingsPort2Field
   ldy #>SettingsPort2Field
   jsr UiLoadRect
   lda SettingsSelection
   jsr SettingsDrawInputField
   lda SettingsDropdown
   beq +
   jsr SettingsDrawInputDropdown
+  lda #<MsgInputHelp
   ldy #>MsgInputHelp
   jmp SettingsDrawFooter

SettingsDrawPort:
   stx SettingsPort
   lda SettingsPortX
   sta RichX
   lda #42
   sta RichY
   lda #0
   sta RichXHi
   sta RichWHi
   lda #88
   sta RichW
   lda #48
   sta RichH
   jsr UiFrame
   ldx #0
SettingsPortDotLoop:
   lda SettingsPortDotX,x
   clc
   adc SettingsPortX
   sta RichX
   lda SettingsPortDotY,x
   clc
   adc #42
   sta RichY
   lda #3
   sta RichW
   sta RichH
   lda #0
   sta RichWHi
   lda #$ff
   sta RichInk
   txa
   pha
   jsr RichRect
   pla
   tax
   inx
   cpx #9
   bne SettingsPortDotLoop
   lda SettingsPortX
   clc
   adc #23
   sta RichX
   lda #31
   sta RichY
   ldx SettingsPort
   lda SettingsPortTitleLo,x
   ldy SettingsPortTitleHi,x
   jmp RichText

SettingsDrawInputField:
   jsr UiButton
   lda RichX
   clc
   adc #10
   sta RichX
   lda RichY
   clc
   adc #6
   sta RichY
   lda SettingsSelection
   pha
   lda SettingsPort
   pha
   lda RichX
   pha
   ;The descriptor's X identifies which field is being drawn.
   lda UiRect
   cmp #160
   bcc +
   lda #1
   bne ++
+  lda #0
++ sta SettingsSelection
   jsr SettingsInputSelectedDevice
   tax
   pla
   sta RichX
   lda SettingsDeviceLo,x
   ldy SettingsDeviceHi,x
   jsr RichText
   lda #'v'
   and #$7f
   jsr RichChar
   pla
   sta SettingsPort
   pla
   sta SettingsSelection
   rts

SettingsDrawInputDropdown:
   lda SettingsDropdown
   cmp #1
   bne SettingsDrawDropPort2
   lda #<SettingsPort1Mouse
   ldy #>SettingsPort1Mouse
   bne SettingsDrawDropMouse
SettingsDrawDropPort2:
   lda #<SettingsPort2Mouse
   ldy #>SettingsPort2Mouse
SettingsDrawDropMouse:
   jsr UiLoadRect
   lda SettingsDropChoice
   beq +
   lda #0
   beq ++
+
   lda #1
++
   jsr SettingsDrawDropMouseButton
   lda SettingsDropdown
   cmp #1
   bne SettingsDrawDropJoyPort2
   lda #<SettingsPort1Joystick
   ldy #>SettingsPort1Joystick
   bne SettingsDrawDropJoy
SettingsDrawDropJoyPort2:
   lda #<SettingsPort2Joystick
   ldy #>SettingsPort2Joystick
SettingsDrawDropJoy:
   jsr UiLoadRect
   lda SettingsDropChoice
   jsr SettingsDrawDropJoyButton
   rts
SettingsDrawDropMouseButton:
   jsr UiButton
   lda RichX
   clc
   adc #20
   sta RichX
   lda RichY
   clc
   adc #4
   sta RichY
   lda #<MsgMouse
   ldy #>MsgMouse
   jmp RichText
SettingsDrawDropJoyButton:
   jsr UiButton
   lda RichX
   clc
   adc #11
   sta RichX
   lda RichY
   clc
   adc #4
   sta RichY
   lda #<MsgJoystick
   ldy #>MsgJoystick
   jmp RichText

SettingsDrawStorage:
   lda #30
   sta SettingsIconX
   lda #36
   sta SettingsIconY
   ldx #1
   jsr SettingsDrawStorageIcon
   lda #<MsgSDCard
   ldy #>MsgSDCard
   jsr SettingsStorageHeading
   lda #rssSDConnected
   ldx #rssSDInfoValid
   ldy #rssSDError
   jsr SettingsDrawMediaState
   bcc SettingsStorageUSB
   lda #52
   sta RichY
   lda #rRegStorageSDTotalMiB0
   ldx #rRegStorageSDFreeMiB0
   jsr SettingsDrawSizeMiB
   lda #64
   sta RichY
   lda #<MsgID
   ldy #>MsgID
   jsr SettingsStorageLineStart
   lda #rRegStorageSDId0
   jsr SettingsPrintRegHex32
SettingsStorageUSB:
   lda #30
   sta SettingsIconX
   lda #84
   sta SettingsIconY
   ldx #2
   jsr SettingsDrawStorageIcon
   lda #<MsgUSBStorage
   ldy #>MsgUSBStorage
   jsr SettingsStorageHeading
   lda #rssUSBConnected
   ldx #rssUSBInfoValid
   ldy #rssUSBError
   jsr SettingsDrawMediaState
   bcc SettingsStorageInternal
   lda #100
   sta RichY
   lda #rRegStorageUSBTotalMiB0
   ldx #rRegStorageUSBFreeMiB0
   jsr SettingsDrawSizeMiB
   lda #112
   sta RichY
   lda #<MsgID
   ldy #>MsgID
   jsr SettingsStorageLineStart
   lda #rRegStorageUSBVendorLo
   jsr SettingsPrintRegHex16
   lda #':'
   jsr RichChar
   lda #rRegStorageUSBProductLo
   jsr SettingsPrintRegHex16
SettingsStorageInternal:
   lda #30
   sta SettingsIconX
   lda #132
   sta SettingsIconY
   ldx #0
   jsr SettingsDrawStorageIcon
   lda #<MsgInternal
   ldy #>MsgInternal
   jsr SettingsStorageHeading
   lda rRegStorageState+IO1Port
   and #rssSnapshotValid+rssInternalInfoValid
   cmp #rssSnapshotValid+rssInternalInfoValid
   bne SettingsStorageInternalUnavailable
   lda #<MsgReady
   ldy #>MsgReady
   jsr SettingsStorageStateText
   lda #148
   sta RichY
   lda #rRegStorageInternalTotalKiB0
   ldx #rRegStorageInternalFreeKiB0
   jsr SettingsDrawSizeKiB
   lda #160
   sta RichY
   lda #<MsgInternalID
   ldy #>MsgInternalID
   jsr SettingsStorageLineStart
   jmp SettingsStorageDone
SettingsStorageInternalUnavailable:
   lda #<MsgUnavailable
   ldy #>MsgUnavailable
   jsr SettingsStorageStateText
SettingsStorageDone:
   lda #<SettingsRefreshRect
   ldy #>SettingsRefreshRect
   jsr UiLoadRect
   lda #0
   jsr UiButton
   lda RichX
   clc
   adc #14
   sta RichX
   lda RichY
   clc
   adc #5
   sta RichY
   lda #<MsgRefresh
   ldy #>MsgRefresh
   jsr RichText
   lda #<MsgStorageHelp
   ldy #>MsgStorageHelp
   jmp SettingsDrawFooter

SettingsDrawStorageIcon:
   lda SettingsIconX
   sta RichX
   lda SettingsIconY
   sta RichY
   lda #0
   sta RichXHi
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
   jmp RichBlit

SettingsStorageHeading:
   sta SettingsText+1
   sty SettingsTextHi+1
   lda #64
   sta RichX
   lda SettingsIconY
   sta RichY
   lda #0
   sta RichXHi
SettingsText:
   lda #0
SettingsTextHi:
   ldy #0
   jmp RichText

; A=connected mask, X=info-valid mask, Y=error mask. Carry returns info valid.
SettingsDrawMediaState:
   sta SettingsConnectedMask
   stx SettingsInfoMask
   sty SettingsErrorMask
   lda rRegStorageState+IO1Port
   and #rssSnapshotValid
   beq SettingsMediaUnavailable
   lda rRegStorageState+IO1Port
   and SettingsConnectedMask
   beq SettingsMediaMissing
   lda rRegStorageState+IO1Port
   and SettingsErrorMask
   bne SettingsMediaError
   lda rRegStorageState+IO1Port
   and SettingsInfoMask
   beq SettingsMediaUnavailable
   lda #<MsgReady
   ldy #>MsgReady
   jsr SettingsStorageStateText
   sec
   rts
SettingsMediaMissing:
   lda #<MsgNotConnected
   ldy #>MsgNotConnected
   bne SettingsMediaTextClear
SettingsMediaError:
   lda #<MsgError
   ldy #>MsgError
   bne SettingsMediaTextClear
SettingsMediaUnavailable:
   lda #<MsgUnavailable
   ldy #>MsgUnavailable
SettingsMediaTextClear:
   jsr SettingsStorageStateText
   clc
   rts
SettingsStorageStateText:
   pha
   tya
   pha
   lda #184
   sta RichX
   lda SettingsIconY
   sta RichY
   pla
   tay
   pla
   jmp RichText

SettingsDrawSizeMiB:
   ldy #<MsgMBFree
   sty SettingsUnitLo
   ldy #>MsgMBFree
   sty SettingsUnitHi
   bne SettingsDrawSize
SettingsDrawSizeKiB:
   ldy #<MsgKBFree
   sty SettingsUnitLo
   ldy #>MsgKBFree
   sty SettingsUnitHi
SettingsDrawSize:
   sta SettingsTotalReg
   stx SettingsFreeReg
   lda #<MsgTotal
   ldy #>MsgTotal
   jsr SettingsStorageLineStart
   lda SettingsTotalReg
   jsr SettingsPrintReg32
   lda SettingsUnitLo
   ldy SettingsUnitHi
   jsr RichText
   lda SettingsFreeReg
   jmp SettingsPrintReg32
SettingsStorageLineStart:
   sta SettingsText+1
   sty SettingsTextHi+1
   lda #64
   sta RichX
   lda #0
   sta RichXHi
   jmp SettingsText

SettingsDrawFooter:
   sta SettingsText+1
   sty SettingsTextHi+1
   lda #34
   sta RichX
   lda #175
   sta RichY
   lda #0
   sta RichXHi
   jmp SettingsText

SettingsDrawPublish:
   jsr GeosRichPublish
   jsr GeosBitmapPublishColors
   lda RichSavedBank
   sta $01
   rts

; ---------------------------------------------------------------------------
; Mouse hit testing

SettingsMouseClick:
   lda #<SettingsWindowRect
   ldy #>SettingsWindowRect
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcc +
   jmp SettingsCloseKey
+  lda SettingsPage
   beq SettingsAppearanceClick
   cmp #SettingsPageInput
   beq SettingsInputClick
   lda #<SettingsRefreshRect
   ldy #>SettingsRefreshRect
   jsr SettingsHit
   bcc +
   jsr SettingsStorageRefresh
   jmp SettingsDraw
+  rts

SettingsAppearanceClick:
   lda #<SettingsLightRect
   ldy #>SettingsLightRect
   jsr SettingsHit
   bcc +
   lda GeosAppearancePrefs
   and #$ff-rpud3AppearanceDark
   jmp SettingsAppearanceSave
+  lda #<SettingsDarkRect
   ldy #>SettingsDarkRect
   jsr SettingsHit
   bcc +
   lda GeosAppearancePrefs
   ora #rpud3AppearanceDark
   jmp SettingsAppearanceSave
+  lda #<SettingsDotsRect
   ldy #>SettingsDotsRect
   jsr SettingsHit
   bcc +
   jmp SettingsAppearanceSetDots
+  lda #<SettingsDitherRect
   ldy #>SettingsDitherRect
   jsr SettingsHit
   bcc +
   jmp SettingsAppearanceSetDithered
+  lda #<SettingsBlankRect
   ldy #>SettingsBlankRect
   jsr SettingsHit
   bcc +
   jmp SettingsAppearanceSetBlank
+  rts

SettingsInputClick:
   lda SettingsDropdown
   beq SettingsInputClickFields
   cmp #1
   bne SettingsInputClickDrop2
   lda #<SettingsPort1Mouse
   ldy #>SettingsPort1Mouse
   jsr SettingsHit
   bcc +
   lda #0
   sta SettingsDropChoice
   jmp SettingsInputCommit
+  lda #<SettingsPort1Joystick
   ldy #>SettingsPort1Joystick
   bne SettingsInputClickJoy
SettingsInputClickDrop2:
   lda #<SettingsPort2Mouse
   ldy #>SettingsPort2Mouse
   jsr SettingsHit
   bcc +
   lda #0
   sta SettingsDropChoice
   jmp SettingsInputCommit
+  lda #<SettingsPort2Joystick
   ldy #>SettingsPort2Joystick
SettingsInputClickJoy:
   jsr SettingsHit
   bcs +
   jmp SettingsInputCancelDrop
+
   lda #1
   sta SettingsDropChoice
   jmp SettingsInputCommit
SettingsInputClickFields:
   lda #<SettingsPort1Field
   ldy #>SettingsPort1Field
   jsr SettingsHit
   bcc +
   lda #0
   sta SettingsSelection
   jmp SettingsInputOpenDrop
+  lda #<SettingsPort2Field
   ldy #>SettingsPort2Field
   jsr SettingsHit
   bcc +
   lda #1
   sta SettingsSelection
   jmp SettingsInputOpenDrop
+  rts
SettingsHit:
   jsr UiLoadRect
   jmp UiHit

; ---------------------------------------------------------------------------
; 32-bit decimal and hexadecimal formatting for fixed storage registers.

SettingsPrintReg32:
   tax
   ldy #0
-  lda IO1Port,x
   sta SettingsNumber,y
   inx
   iny
   cpy #4
   bne -
   lda #<SettingsDecimalPowers
   sta SettingsPowerRead+1
   sta SettingsPowerSubtract+1
   lda #>SettingsDecimalPowers
   sta SettingsPowerRead+2
   sta SettingsPowerSubtract+2
   lda #0
   sta SettingsPowerIndex
   sta SettingsLeading
SettingsDecimalDigit:
   lda #'0'
   sta SettingsDigit
SettingsDecimalCompare:
   ldx #3
-  lda SettingsNumber,x
SettingsPowerRead:
   cmp SettingsDecimalPowers,x
   bcc SettingsDecimalEmit
   bne SettingsDecimalSubtract
   dex
   bpl -
SettingsDecimalSubtract:
   sec
   ldx #0
   ldy #4
-  lda SettingsNumber,x
SettingsPowerSubtract:
   sbc SettingsDecimalPowers,x
   sta SettingsNumber,x
   inx
   dey
   bne -
   inc SettingsDigit
   jmp SettingsDecimalCompare
SettingsDecimalEmit:
   lda SettingsDigit
   cmp #'0'
   bne +
   ldx SettingsLeading
   bne +
   ldx SettingsPowerIndex
   cpx #9
   bne SettingsDecimalNext
+  lda #1
   sta SettingsLeading
   lda SettingsDigit
   jsr RichChar
SettingsDecimalNext:
   clc
   lda SettingsPowerRead+1
   adc #4
   sta SettingsPowerRead+1
   sta SettingsPowerSubtract+1
   bcc +
   inc SettingsPowerRead+2
   inc SettingsPowerSubtract+2
+  inc SettingsPowerIndex
   lda SettingsPowerIndex
   cmp #10
   bne SettingsDecimalDigit
   rts

SettingsPrintRegHex32:
   clc
   adc #3
   tax
   ldy #4
   bne SettingsPrintHex
SettingsPrintRegHex16:
   tax
   inx
   ldy #2
SettingsPrintHex:
   lda IO1Port,x
   jsr SettingsHexByte
   dex
   dey
   bne SettingsPrintHex
   rts
SettingsHexByte:
   pha
   lsr
   lsr
   lsr
   lsr
   jsr SettingsHexNibble
   pla
SettingsHexNibble:
   and #$0f
   cmp #10
   bcc +
   clc
   adc #'A'-10
   jmp RichChar
+  clc
   adc #'0'
   jmp RichChar

SettingsWindowRect: !byte 16,0,12,32,1,176
SettingsLightRect: !byte 48,0,56,72,0,20
SettingsDarkRect: !byte 136,0,56,72,0,20
SettingsDotsRect: !byte 32,0,106,64,0,20
SettingsDitherRect: !byte 104,0,106,112,0,20
SettingsBlankRect: !byte 224,0,106,64,0,20
SettingsPort1Field: !byte 38,0,102,108,0,20
SettingsPort2Field: !byte 174,0,102,108,0,20
SettingsPort1Mouse: !byte 38,0,123,108,0,16
SettingsPort1Joystick: !byte 38,0,139,108,0,16
SettingsPort2Mouse: !byte 174,0,123,108,0,16
SettingsPort2Joystick: !byte 174,0,139,108,0,16
SettingsRefreshRect: !byte 214,0,164,72,0,17

SettingsPortDotX: !byte 12,28,44,60,76,20,36,52,68
SettingsPortDotY: !byte 10,10,10,10,10,28,28,28,28
SettingsJoyKeys: !byte ChrCRSRUp,ChrCRSRDn,ChrCRSRLeft,ChrCRSRRight,ChrReturn
SettingsTitleLo: !byte <MsgAppearance,<MsgInput,0,<MsgStorage
SettingsTitleHi: !byte >MsgAppearance,>MsgInput,0,>MsgStorage
SettingsPortTitleLo: !byte <MsgPort1,<MsgPort2
SettingsPortTitleHi: !byte >MsgPort1,>MsgPort2
SettingsDeviceLo: !byte <MsgMouse,<MsgJoystick
SettingsDeviceHi: !byte >MsgMouse,>MsgJoystick

SettingsDecimalPowers:
   !byte $00,$ca,$9a,$3b, $00,$e1,$f5,$05, $80,$96,$98,$00
   !byte $40,$42,$0f,$00, $a0,$86,$01,$00, $10,$27,$00,$00
   !byte $e8,$03,$00,$00, $64,$00,$00,$00, $0a,$00,$00,$00
   !byte $01,$00,$00,$00

MsgAppearance: !tx "APPEARANCE",0
MsgInput: !tx "INPUT",0
MsgStorage: !tx "STORAGE",0
MsgSettingsMode: !tx "MODE",0
MsgSettingsBackground: !tx "DESKTOP BACKGROUND",0
MsgSettingsFocus: !tx ">",0
MsgLight: !tx "LIGHT",0
MsgDark: !tx "DARK",0
MsgDots: !tx "DOTS",0
MsgDithered: !tx "DITHERED",0
MsgBlank: !tx "BLANK",0
MsgAppearanceHelp: !tx "ARROWS CHOOSE  RETURN APPLIES  ESC CLOSES",0
MsgPort1: !tx "PORT 1",0
MsgPort2: !tx "PORT 2",0
MsgMouse: !tx "MOUSE",0
MsgJoystick: !tx "JOYSTICK",0
MsgInputHelp: !tx "ONE MOUSE MAXIMUM  ESC CLOSES",0
MsgSDCard: !tx "SD CARD",0
MsgUSBStorage: !tx "USB STORAGE",0
MsgInternal: !tx "INTERNAL FLASH",0
MsgReady: !tx "READY",0
MsgNotConnected: !tx "NOT CONNECTED",0
MsgError: !tx "ERROR",0
MsgUnavailable: !tx "UNAVAILABLE",0
MsgTotal: !tx "TOTAL ",0
MsgMBFree: !tx " MB  FREE ",0
MsgKBFree: !tx " KB  FREE ",0
MsgID: !tx "ID ",0
MsgInternalID: !tx "ID BUILT-IN",0
MsgStorageHelp: !tx "RETURN OR CLICK REFRESH",0
MsgRefresh: !tx "REFRESH",0

SettingsPage: !byte 0
SettingsSelection: !byte 0
SettingsDropdown: !byte 0
SettingsDropChoice: !byte 0
SettingsExit: !byte 0
SettingsClick: !byte 0
SettingsJoyLast: !byte $ff
SettingsValue: !byte 0
SettingsPort: !byte 0
SettingsPortX: !byte 0
SettingsIconX: !byte 0
SettingsIconY: !byte 0
SettingsConnectedMask: !byte 0
SettingsInfoMask: !byte 0
SettingsErrorMask: !byte 0
SettingsTotalReg: !byte 0
SettingsFreeReg: !byte 0
SettingsUnitLo: !byte 0
SettingsUnitHi: !byte 0
SettingsNumber: !fill 4,0
SettingsPowerIndex: !byte 0
SettingsLeading: !byte 0
SettingsDigit: !byte 0
