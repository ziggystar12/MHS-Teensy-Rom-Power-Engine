; Shared desktop modal. One geometry drives drawing and hit testing. Callers
; own their actions; a result never starts an operation by itself.
; Mode: 0=OK, 1=Cancel/action, 2=busy (no dismiss), 3=busy with Cancel.
; Result: A=0 none, 1 cancel/close/OK, 2 explicit affirmative action.
GeosDialogOpen:
   sta GeosDialogMode
   lda #0
   sta GeosDialogChoice
   sta GeosDialogPressed
   sta MouseClickEdge
   sta MouseOpenArmed
   sta 198
   lda MouseLeftDown
   sta GeosDialogLastDown
   lda Joystick2Sample
   sta GeosDialogLastJoy
   lda $cb                  ;KERNAL current key: 64 means all keys released
   cmp #64
   lda #0
   rol
   eor #1
   sta GeosDialogKeyHeld
   rts

; A/Y=title, mode already selected. Leaves drawing bank active for body text.
GeosDialogBegin:
   sta GeosDialogTitle+1
   sty GeosDialogTitleHi+1
   jsr Mouse1351HideForRedraw
   jsr GeosRichBegin
   lda #<GeosDialogRect
   ldy #>GeosDialogRect
   jsr UiLoadRect
   jsr UiWindow
   lda #32
   sta RichX
   lda #46
   sta RichY
   lda #0
   sta RichXHi
   lda #$ff
   sta RichInk
GeosDialogTitle:
   lda #0
GeosDialogTitleHi:
   ldy #0
   jsr RichText
   lda GeosDialogMode
   cmp #2
   bne +
   lda #<GeosDialogCloseRect
   ldy #>GeosDialogCloseRect
   jsr UiLoadRect
   lda #0                   ;busy operation has no working close control
   sta RichInk
   jsr RichRect
+  jsr GeosDialogButtons
   jmp GeosDialogBodyReset

; Caller has mapped the canvas. Draw the same two button rectangles used below.
GeosDialogButtons:
   lda GeosDialogMode
   cmp #2
   beq GeosDialogButtonsDone
   lda #<GeosDialogLeftRect
   ldy #>GeosDialogLeftRect
   jsr UiLoadRect
   lda GeosDialogChoice
   eor #1
   jsr UiButton
   lda #80
   sta RichX
   lda #144
   sta RichY
   lda #<GeosDialogCancelText
   ldy #>GeosDialogCancelText
   ldx GeosDialogMode
   bne +
   lda #<GeosDialogOKText
   ldy #>GeosDialogOKText
+  jsr RichText
   lda GeosDialogMode
   cmp #1
   bne GeosDialogButtonsDone
   lda #<GeosDialogRightRect
   ldy #>GeosDialogRightRect
   jsr UiLoadRect
   lda GeosDialogChoice
   jsr UiButton
   lda #190
   sta RichX
   lda #144
   sta RichY
   lda GeosDialogAction
   ldy GeosDialogAction+1
   jsr RichText
GeosDialogButtonsDone:
   rts

; Draw-only body accepts the complete 255-byte ASCII filename: six rows of
; 43 glyphs. No hidden extension, case conversion, or clipped confirmation.
GeosDialogBodyReset:
   lda #<GeosDialogBodyRect
   ldy #>GeosDialogBodyRect
   jsr UiLoadRect
   lda #0
   sta RichInk
   jsr RichRect
   lda #31
   sta RichX
   lda #60
   sta RichY
   lda #$ff
   sta RichInk
   lda #43
   sta GeosDialogColumn
   lda #6
   sta GeosDialogLines
   lda #0
   sta GeosDialogTextMode
   rts

GeosDialogChar:
   ldx GeosDialogTextMode
   bne GeosDialogMessageChar
   cmp #32
   bcc GeosDialogInvalidChar
   cmp #127
   bcc GeosDialogCheckSpace
GeosDialogInvalidChar:
   lda #'?'
   bne GeosDialogCheckSpace
GeosDialogMessageChar:
   cmp #13
   beq GeosDialogNewline
   cmp #10
   beq GeosDialogNewline
   cmp #32
   bcc GeosDialogCharDone
   cmp #$80
   bcc +
   cmp #$a0
   bcc GeosDialogCharDone
   and #$7f
+  cmp #127
   bcc +
   lda #'?'
+
GeosDialogCheckSpace:
   ldx GeosDialogLines
   beq GeosDialogCharDone
GeosDialogGlyph:
   jsr RichChar
   dec GeosDialogColumn
   bne GeosDialogCharDone
GeosDialogNewline:
   lda GeosDialogColumn
   cmp #43
   beq GeosDialogCharDone   ;ignore newline following exact wrap
   lda GeosDialogLines
   beq GeosDialogCharDone
   dec GeosDialogLines
   lda #43
   sta GeosDialogColumn
   lda #31
   sta RichX
   lda #0
   sta RichXHi
   lda RichY
   clc
   adc #10
   sta RichY
GeosDialogCharDone:
   rts

; Compact status row below the complete filename/body.
GeosDialogStatus:
   lda #<GeosDialogStatusRect
   ldy #>GeosDialogStatusRect
   jsr UiLoadRect
   lda #0
   sta RichInk
   jsr RichRect
   lda #31
   sta RichX
   lda #122
   sta RichY
   lda #43
   sta GeosDialogColumn
   lda #1
   sta GeosDialogLines
   sta GeosDialogTextMode
   lda #$ff
   sta RichInk
   rts

; A=serial selector; all data is drained even if the body becomes full.
; Filename mode is raw ASCII. Message/status mode uses the backend's PETSCII
; wire; local notices remain ASCII. Preserve newline and control filtering.
GeosDialogSerial:
   sta rwRegSerialString+IO1Port
-  lda rwRegSerialString+IO1Port
   beq GeosDialogCharDone
   ldx GeosDialogTextMode
   beq +
   cmp #32
   bcc +
   cmp #$80
   bcc ++
   cmp #$a0
   bcc +
++ jsr BrowserPETSCIIToASCII
+
   jsr GeosDialogChar
   jmp -

; A/Y=local zero terminated ASCII text; source may cross a page boundary.
GeosDialogLocal:
   sta GeosDialogLocalRead+1
   sty GeosDialogLocalRead+2
GeosDialogLocalRead:
   lda $ffff
   beq GeosDialogCharDone
   jsr GeosDialogChar
   inc GeosDialogLocalRead+1
   bne GeosDialogLocalRead
   inc GeosDialogLocalRead+2
   jmp GeosDialogLocalRead

GeosDialogPublish:
   jsr GeosBitmapWaitPublish
GeosDialogRestoreBank:
   lda RichSavedBank
   sta $01
   rts

; Modal polling deliberately excludes navigation and remote launch dispatch.
GeosDialogPoll:
   jsr GetIn
   pha
   lda GeosDialogKeyHeld
   beq +
   lda $cb
   cmp #64
   bne GeosDialogHeldKey
   lda #0
   sta GeosDialogKeyHeld
GeosDialogHeldKey:
   pla
   jmp GeosDialogPointer
+  pla
   beq GeosDialogPointer
GeosDialogKey:
   ldx GeosDialogMode
   cpx #2
   beq GeosDialogNoInput
   cmp #ChrStop
   beq GeosDialogCancel
   cmp #27
   beq GeosDialogCancel
   cmp #ChrHome
   beq GeosDialogCancel
   cmp #'n'
   beq GeosDialogCancel
   cmp #'N'
   beq GeosDialogCancel
   cmp #ChrReturn
   beq GeosDialogEnter
   cpx #1
   bne GeosDialogNoInput
   cmp #'y'
   beq GeosDialogConfirm
   cmp #'Y'
   beq GeosDialogConfirm
   cmp #ChrCRSRLeft
   beq GeosDialogChoose
   cmp #ChrCRSRRight
   beq GeosDialogChoose
   cmp #ChrCRSRUp
   beq GeosDialogChoose
   cmp #ChrCRSRDn
   bne GeosDialogNoInput
GeosDialogChoose:
   lda GeosDialogChoice
   eor #1
   sta GeosDialogChoice
   jsr GeosRichBegin
   jsr GeosDialogButtons
   ; Both choices changed, while the title, body and window remain identical.
   ; Publish one tight band spanning the two buttons and their existing gap.
   lda #<GeosDialogLeftRect
   ldy #>GeosDialogLeftRect
   jsr UiLoadRect
   lda #194
   sta RichW
   jsr UiPublishRect
   jsr GeosDialogRestoreBank
   jmp GeosDialogNoInput
GeosDialogNoInput:
   lda #0
   rts
GeosDialogEnter:
   cpx #1
   bne GeosDialogCancel
   lda GeosDialogChoice
   beq GeosDialogCancel
GeosDialogConfirm:
   lda #2
   rts
GeosDialogCancel:
   lda #1
   rts

GeosDialogPointer:
   php
   sei
   lda MouseLogicalX
   sta MouseFrameX
   lda MouseLogicalY
   sta MouseFrameY
   lda MouseLeftDown
   sta MouseFrameDown
   lda #0
   sta MouseClickEdge
   plp
   lda MouseActive
   beq GeosDialogJoystick
   lda #1
   sta MouseMenuEnabled
   jsr Mouse1351ShowPointer
   lda MouseFrameDown
   cmp GeosDialogLastDown
   beq GeosDialogJoystick
   sta GeosDialogLastDown
   jsr GeosDialogHit
   ldx MouseFrameDown
   beq GeosDialogReleased
   sta GeosDialogPressed
   jmp GeosDialogNoInput
GeosDialogReleased:
   ldx GeosDialogPressed
   pha
   lda #0
   sta GeosDialogPressed
   pla
   cmp #0                  ;zero cannot activate a control
   beq GeosDialogNoInput
   stx GeosDialogHitResult
   cmp GeosDialogHitResult
   bne GeosDialogNoInput
   cmp #3                  ;X and Cancel share a result, not a hit target
   bne +
   lda #1
+
   rts
GeosDialogJoystick:
   lda Joystick2Sample
   cmp GeosDialogLastJoy
   beq GeosDialogNoHit
   sta GeosDialogLastJoy
   and #$10
   beq GeosDialogJoyEnter
   lda GeosDialogLastJoy
   and #$0f
   cmp #$0f
   beq GeosDialogNoHit
   lda #ChrCRSRRight
   jmp GeosDialogKey
GeosDialogJoyEnter:
   lda #ChrReturn
   jmp GeosDialogKey

GeosDialogHit:
   lda GeosDialogMode
   cmp #2
   beq GeosDialogNoHit
   lda #<GeosDialogRect
   ldy #>GeosDialogRect
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcc +
   lda #3
   rts
+
   lda #<GeosDialogLeftRect
   ldy #>GeosDialogLeftRect
   jsr UiLoadRect
   jsr UiHit
   bcc +
   lda #1
   rts
+
   lda GeosDialogMode
   cmp #1
   bne GeosDialogNoHit
   lda #<GeosDialogRightRect
   ldy #>GeosDialogRightRect
   jsr UiLoadRect
   jsr UiHit
   bcc GeosDialogNoHit
   lda #2
   rts
GeosDialogNoHit:
   lda #0
   rts

GeosDialogWait:
   jsr GeosDialogPoll
   beq GeosDialogWait
   rts

; Ordinary desktop shortcuts share the same result frame. Unhandled keys and
; the compact/classic character screen retain their existing routing.
GeosActionKey:
   sta GeosActionOriginal+1
   ldx GeosBitmapActive
   beq GeosActionNotHandled
   cmp #'M'
   beq GeosActionMount
   ldx #2
-  cmp GeosActionKeys,x
   beq GeosActionCommand
   dex
   bpl -
   cmp #'!'
   bcc GeosActionNotHandled
   cmp #'!'+NumHotKeys
   bcs GeosActionNotHandled
   sec
   sbc #'!'
   ora #$80
   sta rwRegScratch+IO1Port
   lda #rCtlHotKeySetLaunch
   bne GeosActionExecute
GeosActionCommand:
   lda GeosActionCommands,x
GeosActionExecute:
   jsr GeosActionRun
   lda #1
GeosActionRedraw:
   pha
   jsr ListMenuItems
   pla
   sec
   rts
GeosActionNotHandled:
   clc
GeosActionOriginal:
   lda #0
   rts
GeosActionMount:
   lda #rCtlMountDxxFileWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRDots
   lda rwRegScratch+IO1Port
   beq GeosActionMountDone
   lda #<GeosActionRunText
   sta GeosDialogAction
   lda #>GeosActionRunText
   sta GeosDialogAction+1
   lda #1
   ldx #<GeosActionMountTitle
   ldy #>GeosActionMountTitle
   jsr GeosBitmapWaitFinished
   jsr GeosDialogWait
   jmp GeosActionRedraw
GeosActionMountDone:
   jsr GeosActionComplete
   lda #1
   jmp GeosActionRedraw

; A=existing WAIT command. Preserve its latest complete backend result.
GeosActionRun:
   sta wRegControl+IO1Port
   jsr WaitForTRDots
GeosActionComplete:
   lda #0
   ldx #<MsgGeosInformation
   ldy #>MsgGeosInformation
   jsr GeosBitmapWaitFinished
   jmp GeosDialogWait

; The selected file/random-directory flag has already been put in scratch.
; Cancel never writes a tag, and every exit returns through NFC re-enable.
GeosActionNFC:
   lda #rCtlWriteNFCTagCheckWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRDots
   lda rRegLastHourBCD+IO1Port
   beq GeosActionNFCRemove
   lda #<GeosActionPlaceTag
   ldy #>GeosActionPlaceTag
   jsr GeosActionStatus
   lda #<GeosActionWriteText
   sta GeosDialogAction
   lda #>GeosActionWriteText
   sta GeosDialogAction+1
   lda #1
   ldx #<GeosActionNFCTitle
   ldy #>GeosActionNFCTitle
   jsr GeosBitmapWaitFinished
   jsr GeosDialogWait
   cmp #2
   bne GeosActionNFCRemove
   lda #rCtlWriteNFCTagWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRDots
GeosActionNFCRemove:
   lda #<GeosActionRemoveTag
   ldy #>GeosActionRemoveTag
   jsr GeosActionStatus
   jsr GeosActionComplete
   lda #rCtlNFCReEnableWAIT
   sta wRegControl+IO1Port
   jmp WaitForTRDots

; Add an instruction below the result, retaining the backend's filename/error.
GeosActionStatus:
   pha
   tya
   pha
   jsr GeosRichBegin
   jsr GeosDialogStatus
   pla
   tay
   pla
   jsr GeosDialogLocal
   jsr GeosDialogPublish
   rts

GeosActionKeys: !byte 'A','K','R'
GeosActionCommands: !byte rCtlSetAutoLaunchWAIT,rCtlSetKERNALBinWAIT,rCtlSetREUFileWAIT

; Desktop firmware confirmation runs before IRQDisable so the IRQ mouse
; sampler remains available. The existing compact text updater stays intact.
; Discovery is called only from desktop startup, after its first bitmap draw.
; It captures an SD-root candidate without changing the current file selection.
GeosFirmwareStartup:
   lda GeosBitmapActive
   beq +
   lda #rCtlFirmwareDiscoverWAIT
   jsr GeosFirmwareRequest
   beq GeosFirmwarePrepared
   jmp GeosFirmwareDone      ;clear any failed capture and remove the wait dialog
+  rts

GeosFirmwareConfirm:
   lda #rCtlFirmwarePrepareWAIT
   jsr GeosFirmwareRequest
   bne GeosFirmwareChanged
GeosFirmwarePrepared:
   lda #<GeosDialogUpdateText
   sta GeosDialogAction
   lda #>GeosDialogUpdateText
   sta GeosDialogAction+1
   lda #1
   jsr GeosDialogOpen
   lda #<GeosFirmwareTitle
   ldy #>GeosFirmwareTitle
   jsr GeosDialogBegin
   lda #rsstFirmwareName
   jsr GeosDialogSerial
   jsr GeosDialogStatus
   lda #<GeosFirmwareWarning
   ldy #>GeosFirmwareWarning
   jsr GeosDialogLocal
   jsr GeosDialogPublish
   jsr GeosDialogWait
   cmp #2
   bne GeosFirmwareDone
   lda #rCtlFirmwareCheckWAIT
   jsr GeosFirmwareRequest
   bne GeosFirmwareChanged
   ; Only a fresh explicit affirmative reaches the unchanged update command.
   jsr IRQDisable
   jsr StartSelItem_WaitForTRDots
   jsr AnyKeyErrMsgWait
GeosFirmwareDone:
   lda #rCtlFirmwareCancel
   sta wRegControl+IO1Port
   jmp ListAndDone
GeosFirmwareChanged:
   lda #<GeosFirmwareChangedText
   ldy #>GeosFirmwareChangedText
   jsr GeosBitmapShowMessage
   jsr GeosDialogWait
   jmp GeosFirmwareDone
GeosFirmwareRequest:
   inc UiWaitCancelable
   sta wRegControl+IO1Port
   sec
   jsr WaitForTRWaitMsg
   bcs +
   sta wRegControl+IO1Port
   rts
+
   dec UiWaitCancelable
   lda rRegFirmwareTargetState+IO1Port
   cmp #1
   rts

!convtab raw {
GeosActionRunText: !tx "Run",0
GeosActionWriteText: !tx "Write",0
GeosActionMountTitle: !tx "Run mounted disk?",0
GeosActionNFCTitle: !tx "Write NFC tag?",0
GeosActionPlaceTag: !tx "Place the tag in the reader.",0
GeosActionRemoveTag: !tx "Remove the tag, then choose OK.",0
GeosFirmwareChangedText: !tx "Firmware selection changed. Choose the file again.",0
GeosFirmwareTitle: !tx "Update firmware?",0
GeosFirmwareWarning: !tx "Keep power on during the update.",0
GeosDialogRect:       !byte 24,0,42,16,1,116
GeosDialogCloseRect:  !byte 26,1,44,11,0,11
GeosDialogBodyRect:   !byte 31,0,60,2,1,59
GeosDialogStatusRect: !byte 31,0,121,2,1,11
GeosDialogLeftRect:   !byte 62,0,142,82,0,11
GeosDialogRightRect:  !byte 174,0,142,82,0,11
GeosDialogCancelText: !tx "Cancel",0
GeosDialogOKText:     !tx "OK",0
GeosDialogUpdateText: !tx "Update",0
GeosDialogDeleteText: !tx "Delete",0
GeosDialogMode:       !byte 0
GeosDialogChoice:     !byte 0
GeosDialogPressed:    !byte 0
GeosDialogLastDown:   !byte 0
GeosDialogLastJoy:    !byte $ff
GeosDialogKeyHeld:    !byte 0
GeosDialogHitResult:  !byte 0
GeosDialogColumn:     !byte 0
GeosDialogLines:      !byte 0
GeosDialogTextMode:   !byte 0
GeosDialogAction:     !word GeosDialogUpdateText

}
