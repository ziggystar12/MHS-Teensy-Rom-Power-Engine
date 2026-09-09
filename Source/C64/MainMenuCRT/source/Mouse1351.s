; 1351 proportional mouse support for the GEOS-style main-menu desktop.
;
; The persisted input layout selects a proportional mouse in either control
; port, with the other port used as the desktop joystick, or two joysticks.
; The IRQ sampler reads the SID POT counters before the KERNAL keyboard scan.
; It samples both digital ports while neither CIA side drives the keyboard
; matrix, then temporarily blinds SCNKEY while a mouse switch is held.  The
; public Joystick2Sample name is retained for the rest of the menu, but holds
; the configured desktop joystick (or the active-low union of two joysticks).

   MouseLogicalXMax = 159
   MouseLogicalYMax = 199
   MouseScreenXBias = 24
   MouseScreenYBias = 50
   ;Aligned tape-buffer RAM is free while the menu is active.  The PRG launch
   ;stub may overwrite it only after RunSelected has hidden the pointer.
   MouseSpriteDataRAM = $0340
   MouseSpritePointerValue = MouseSpriteDataRAM/64
   MouseMotionActivateFrames = 3
   MouseClickActivateFrames = 2
   MouseButtonDebounceFrames = 2
   MousePlausibleDeltaLimit = 17 ;absolute deltas 1..16 count as presence
   GeosInputDeviceJoystick = 0
   GeosInputDeviceMouse = 1
   MousePotSelectPort1 = $7f ;CIA PA7:6=%01, inactive digital lines high
   MousePotSelectPort2 = $bf ;CIA PA7:6=%10, inactive digital lines high

   ;Private virtual-key values consumed before the normal keyboard map.
   MouseEventPagePrev = $f0
   MouseEventPageNext = $f1
!ifdef DesktopShell {
   MouseEventMenuDesk = $f2
   MouseEventMenuFile = $f3
   MouseEventMenuEdit = $f4
   MouseEventMenuView = $f5
   MouseEventMenuDisk = $f6
}

; Copy the sprite, load the persisted input layout, and leave the pointer
; hidden.  A reserved layout value is treated as the backward-compatible
; Mouse 1 / Joystick 2 default.
Mouse1351Init:
   php
   sei
   lda #0
   sta MouseCalibrated
   sta MouseActive
   sta MouseMenuEnabled
   sta MouseMotionScore
   sta MouseButtonScore
   sta MouseFrameMoved
   sta MouseLeftDown
   sta MouseNewLeftDown
   sta MouseButtonDebounceCount
   sta MouseClickEdge
   sta MouseOpenArmed
   sta MousePotSelectionReady
   sta MousePotSampleValid
   lda #$ff
   sta Joystick2Sample
   sta InputPort1Sample
   sta InputPort2Sample
   lda #80
   sta MouseLogicalX
   lda #100
   sta MouseLogicalY

   jsr Mouse1351CopyPointer

   lda #MouseSpritePointerValue
   sta Sprite0Pointer
   lda #PokeBlack
   sta Sprite0Color
   lda SpriteEnable
   and #%11111110
   sta SpriteEnable
   lda SpriteYExpand
   and #%11111110
   sta SpriteYExpand
   lda SpriteXExpand
   and #%11111110
   sta SpriteXExpand
   lda SpriteMulticolor
   and #%11111110
   sta SpriteMulticolor
   lda SpritePriority
   and #%11111110
   sta SpritePriority
   jsr GeosInputReload
   plp
   rts

; Public settings contract.  Layout values are the rpud3Input* constants.
; GeosInputGetLayout returns the normalized live value in A.
; GeosInputSetLayout accepts one of those values in A, normalizes the reserved
; value to Mouse 1 / Joystick 2, applies it immediately, and persists it while
; preserving every unrelated rwRegPwrUpDefaults3 bit.
GeosInputGetLayout:
   lda GeosInputLayout
   rts

GeosInputSetLayout:
   jsr GeosInputNormalizeLayout
   sta GeosInputPendingLayout
   lda rwRegPwrUpDefaults3+IO1Port
   and #rpud3InputLayoutMask
   cmp GeosInputPendingLayout
   beq GeosInputSetApply
   lda rwRegPwrUpDefaults3+IO1Port
   and #$ff-rpud3InputLayoutMask
   ora GeosInputPendingLayout
   sta rwRegPwrUpDefaults3+IO1Port
   jsr WaitForTRWaitMsg
GeosInputSetApply:
   lda GeosInputPendingLayout
   cmp GeosInputLayout
   beq GeosInputSetDone
   jsr GeosInputApplyLayout
GeosInputSetDone:
   lda GeosInputLayout
   rts

GeosInputReload:
   lda rwRegPwrUpDefaults3+IO1Port
   jsr GeosInputNormalizeLayout
   jmp GeosInputApplyLayout
GeosInputNormalizeLayout:
   and #rpud3InputLayoutMask
   cmp #rpud3InputInvalid
   bne +
   lda #rpud3InputMouse1Joy2
+  rts

GeosInputApplyLayout:
   php
   sei
   sta GeosInputLayout
   lda #0
   sta MouseCalibrated
   sta MouseActive
   sta MouseMenuEnabled
   sta MouseMotionScore
   sta MouseButtonScore
   sta MouseLeftDown
   sta MouseNewLeftDown
   sta MouseButtonDebounceCount
   sta MouseClickEdge
   sta MouseOpenArmed
   sta MousePotSelectionReady
   sta MousePotSampleValid
   jsr Mouse1351HideForRedraw
   lda #$ff
   sta Joystick2Sample
   sta InputPort1Sample
   sta InputPort2Sample
   jsr Mouse1351SelectConfiguredPots
   plp
   rts

; The KERNAL key scan normally leaves the port-1 POT pair selected.  For a
; port-2 mouse the normal menu loop restores PA7:6=%10 after each scan, normally
; leaving SID past its documented 1.6 ms settling interval by the next frame
; sample.  Long blocking draws may skip port-2 movement samples; they do not
; substitute values from the wrong port.
Mouse1351SelectConfiguredPots:
   lda GeosInputLayout
   cmp #rpud3InputJoy1Joy2
   beq MousePotSelectNone
   lda #MousePotSelectPort1
   ldx GeosInputLayout
   beq MouseStorePotSelect
   lda #MousePotSelectPort2
MouseStorePotSelect:
   pha
   lda #$c0
   sta CIA1_DDRA
   pla
   sta CIA1_RegA
   lda #1
   sta MousePotSelectionReady
MousePotSelectDone:
   rts
MousePotSelectNone:
   lda #0
   sta MousePotSelectionReady
   rts

Mouse1351CopyPointer:
   ldx #63
-  lda MousePointerSpriteData,x
   sta MouseSpriteDataRAM,x
   dex
   bpl -
   rts

!ifdef DesktopShell {
; A dragged desktop icon temporarily replaces the arrow in sprite zero. The
; 24x16 native icon rows already have the VIC sprite's three-byte row layout;
; five transparent rows keep the complete 24x21 sprite bounded at the mouse.
Mouse1351DragIconBegin:
   ldx #15
   lda #0
-  sta MouseSpriteDataRAM+48,x
   dex
   bpl -
   ldx GeosDragCandidate
   lda RichIconLo,x
   sta MouseDragIconRead+1
   lda RichIconHi,x
   sta MouseDragIconRead+2
   ldx #47
MouseDragIconRead:
   lda $ffff,x
   sta MouseSpriteDataRAM,x
   dex
   bpl MouseDragIconRead
   rts

Mouse1351DragIconEnd = Mouse1351CopyPointer
}

; Hide the pointer while redrawing the text surface without discarding a click
; edge or the first-click open state.  The next menu pass restores the sprite.
Mouse1351HideForRedraw:
   lda SpriteEnable
   and #%11111110
   sta SpriteEnable
   rts

; Disable sprite 0 and discard menu-local click state for a true mode exit.
; Mouse presence and coordinates survive so the pointer can return later.
Mouse1351Hide:
   jsr Mouse1351HideForRedraw
   lda #0
   sta MouseMenuEnabled
   sta MouseClickEdge
   sta MouseOpenArmed
   rts

; Classic text mode does not use the desktop mouse. More importantly, restore
; the CIA to the KERNAL's normal keyboard-scan idle state before GetIn runs.
; The desktop sampler can deliberately drive DDRB to suppress a phantom key;
; leaving that behind made cursor keys unreliable after a live GUI -> text
; switch. This is safe from either the foreground or the IRQ path.
Mouse1351RestoreKeyboard:
   php
   sei
   lda #0
   sta CIA1_DDRB
   lda #$ff
   sta CIA1_DDRA
   sta CIA1_RegA
   plp
   clc
   rts

; Called once around the main menu loop.  Carry clear means no virtual key;
; carry set returns an existing key code (or a private page event) in A.
Mouse1351ProcessMenu:
   lda GeosViewMode
   bne MouseProcessCheckActive
   jsr Mouse1351Hide
   jmp Mouse1351RestoreKeyboard

MouseProcessCheckActive:
   jsr Mouse1351SelectConfiguredPots
   lda MouseActive
   bne MouseProcessSnapshot
   jsr Mouse1351Hide
   clc
   rts

MouseProcessSnapshot:
   lda #1
   sta MouseMenuEnabled
   php
   sei
   lda MouseLogicalX
   sta MouseFrameX
   lda MouseLogicalY
   sta MouseFrameY
   lda MouseClickEdge
   sta MouseFrameClick
   lda MouseLeftDown
   sta MouseFrameDown
   lda #0
   sta MouseClickEdge
   plp

   jsr Mouse1351ShowPointer

!ifdef DesktopShell {
   ;Held/released state is needed for real drag-and-drop; ordinary click edges
   ;continue through the same two-click activation path below.
   jsr GeosShellMouseDragFrame
}

   ;A keyboard/joystick move changes the shared cursor item.  Do not let a
   ;later mouse click count as a second click on stale mouse state.
   lda MouseOpenArmed
   beq MouseProcessClickCheck
   lda MouseLastClickedItem
!ifdef DesktopShell {
   pha
   jsr GeosShellMouseSelectionValue
   sta MouseHitItem
   pla
   cmp MouseHitItem
}
!ifndef DesktopShell {
   cmp rwRegCursorItemOnPg+IO1Port
}
   beq MouseProcessClickCheck
   lda #0
   sta MouseOpenArmed

MouseProcessClickCheck:
   lda MouseFrameClick
   bne MouseProcessClick
   clc
   rts

MouseProcessClick:
   lda MouseFrameX
   lsr
   lsr
   tax                         ;logical X / 4 = text column
   lda MouseFrameY
   lsr
   lsr
   lsr
   tay                         ;logical Y / 8 = text row

!ifdef DesktopShell {
   ;The expanded shell owns menu/control/home hit testing and jumps back into
   ;the proven browser/footer handlers when those regions apply.
   jmp GeosShellMouseClick
}

!ifndef DesktopShell {
; Only the compact recovery menu uses the legacy character-grid chrome. The
; desktop dispatcher above handles its pixel rectangles and cannot fall here.
   cpy #0
   beq MouseHitTitleBar
   cpy #1
   beq MouseHitPageBar
   cpy #22
   beq MouseHitSourceBar
   cpy #24
   beq MouseHitActionBar
   jmp MouseHitDesktop

; The visible V VIEW label is clickable.  F2/BASIC intentionally remains a
; keyboard-only operation so an imprecise pointer cannot exit unexpectedly.
MouseHitTitleBar:
   cpx #19
   bcs +
   jmp MouseNoTarget
+
   cpx #27
   bcc +
   jmp MouseNoTarget
+
   lda #'V'
   jmp MouseReturnVirtualKey

; The left and right halves of the visible Pg n/m field page backward/forward.
MouseHitPageBar:
!ifdef DesktopShell {
   cpx #25
   bcs +
   jmp MouseNoTarget
+
   cpx #30
   bcc MouseReturnPagePrev
   cpx #40
   bcc +
   jmp MouseNoTarget
+
   lda #MouseEventPageNext
   jmp MouseReturnVirtualKey
}
!ifndef DesktopShell {
   cpx #18
   bcs +
   jmp MouseNoTarget
+
   cpx #24
   bcc MouseReturnPagePrev
   cpx #29                     ;stop before the clock at column 29
   bcc +
   jmp MouseNoTarget
+
   lda #MouseEventPageNext
   jmp MouseReturnVirtualKey
}
MouseReturnPagePrev:
   lda #MouseEventPagePrev
   jmp MouseReturnVirtualKey

; Footer row 22 contains the existing source/help labels.
MouseHitSourceBar:
   cpx #10
   bcc MouseReturnF1
   cpx #17
   bcc MouseReturnF3
   cpx #25
   bcc MouseReturnF5
   cpx #35
   bcc MouseReturnF7
   jmp MouseNoTarget
MouseReturnF1:
   lda #ChrF1
   jmp MouseReturnVirtualKey
MouseReturnF3:
   lda #ChrF3
   jmp MouseReturnVirtualKey
MouseReturnF5:
   lda #ChrF5
   jmp MouseReturnVirtualKey
MouseReturnF7:
   lda #ChrF7
   jmp MouseReturnVirtualKey

; Footer row 24 exposes Parent, Home, Music, and Settings with their existing
; keyboard codes.  This keeps the shortcut implementation single-sourced.
MouseHitActionBar:
   cpx #9
   bcc MouseReturnParent
   cpx #19
   bcc MouseReturnHome
   cpx #29
   bcc MouseReturnF4
   cpx #38
   bcc MouseReturnF8
   jmp MouseNoTarget
MouseReturnParent:
   lda #ChrUpArrow
   jmp MouseReturnVirtualKey
MouseReturnHome:
   lda #ChrHome
   jmp MouseReturnVirtualKey
MouseReturnF4:
   lda #ChrF4
   jmp MouseReturnVirtualKey
MouseReturnF8:
   lda #ChrF8
   jmp MouseReturnVirtualKey
}

MouseHitDesktop:
!ifdef DesktopShell {
   jsr GeosRichHitFile
}
!ifndef DesktopShell {
   jsr GeosHitTest
}
   bcc MouseNoTarget
   sta MouseHitItem

   ;Opening is deliberately two-click, not merely "already keyboard focused".
   ;The first click selects/arms an item; a later click on that same still-
   ;selected item returns Return through the existing SelectItem path.
   lda MouseOpenArmed
   beq MouseSelectAndArm
   lda MouseLastClickedItem
   cmp MouseHitItem
   bne MouseSelectAndArm
   lda rwRegCursorItemOnPg+IO1Port
   cmp MouseHitItem
   bne MouseSelectAndArm
   lda #0
   sta MouseOpenArmed
   lda #ChrReturn
   sec
   rts

MouseSelectAndArm:
   lda MouseHitItem
   sta MouseLastClickedItem
   lda #1
   sta MouseOpenArmed
   lda MouseHitItem
   jsr GeosSetSelection
   clc
   rts

MouseNoTarget:
   lda #0
   sta MouseOpenArmed
   clc
   rts

MouseReturnVirtualKey:
   pha
   lda #0
   sta MouseOpenArmed
   pla
   sec
   rts

; Convert the 160x200 logical position to VIC sprite coordinates.  The screen
; origin biases keep the pointer hotspot aligned with the 40x25 text display.
Mouse1351ShowPointer:
   lda #MouseSpritePointerValue
   sta Sprite0Pointer
   ;Keep the pointer and drag ghost visible over the current bitmap surface.
   ;The compact/classic menu does not define desktop appearance state.
   lda #PokeBlack
   sta Sprite0Color
!ifdef DesktopShell {
   lda GeosAppearancePrefs
   and #rpud3AppearanceDark
   beq +
   lda #PokeWhite
   sta Sprite0Color
+
}

!ifdef DesktopShell {
   ;Do not overwrite a newer IRQ position with the older main-loop snapshot.
   ;Only the three coordinate registers are atomic; rendering stays interruptible.
   php
   sei
   jsr Mouse1351PublishPosition
   plp
}
!ifndef DesktopShell {
   lda MouseFrameX
   asl
   sta MousePhysicalXLo
   lda #0
   adc #0
   sta MousePhysicalXHi
   lda MousePhysicalXLo
   clc
   adc #MouseScreenXBias
   sta Sprite0Xpos
   lda MousePhysicalXHi
   adc #0
   and #1
   sta MousePhysicalXHi
   lda SpriteXMSB
   and #%11111110
   ora MousePhysicalXHi
   sta SpriteXMSB

   lda MouseFrameY
   clc
   adc #MouseScreenYBias
   sta Sprite0Ypos
}

   lda SpriteYExpand
   and #%11111110
   sta SpriteYExpand
   lda SpriteXExpand
   and #%11111110
   sta SpriteXExpand
   lda SpriteMulticolor
   and #%11111110
   sta SpriteMulticolor
   lda SpritePriority
   and #%11111110
   sta SpritePriority
   lda SpriteEnable
   ora #1
   sta SpriteEnable
   rts

!ifdef DesktopShell {
; Live sprite position only. No renderer operands, zero page, frame snapshot,
; click state or visibility changes. x*2+24 crosses $100 at logical x=116.
Mouse1351PublishPosition:
   ldx MouseLogicalX
   txa
   asl
   clc
   adc #MouseScreenXBias
   sta Sprite0Xpos
   lda SpriteXMSB
   and #%11111110
   cpx #116
   bcc +
   ora #1
+  sta SpriteXMSB
   lda MouseLogicalY
   clc
   adc #MouseScreenYBias
   sta Sprite0Ypos
   rts
}

; IRQ-side sampler.  The first mouse sample is calibration only. Presence becomes
; active after three consecutive plausible movement frames or after a stable,
; deliberate mouse fire press lasting two samples.  The activating press is
; consumed, preventing a stationary mouse from accidentally opening an item.
Mouse1351IRQSample:
!ifdef DesktopShell {
   ;Do not touch the controller/keyboard matrix while the classic list is
   ;active. It is a true recovery UI and must retain ordinary cursor keys.
   lda GeosViewMode
   beq Mouse1351IRQClassic
   jsr Mouse1351SampleState
   lda MouseActive
   beq Mouse1351IRQDone
   lda MouseMenuEnabled
   beq Mouse1351IRQDone
   jmp Mouse1351PublishPosition
Mouse1351IRQDone:
   rts
Mouse1351IRQClassic:
   jmp Mouse1351RestoreKeyboard
}
Mouse1351SampleState:
   ;Read a configured mouse before opening the CIA selector lines for the
   ;digital snapshot.  Reading after that transition would violate the SID
   ;POT settling requirement and could report the other control port.
   lda GeosInputLayout
   beq MouseInputReadPots       ;KERNAL itself leaves port 1 selected
   cmp #rpud3InputJoy1Joy2
   beq MouseInputSampleDigital
   lda MousePotSelectionReady  ;port 2 must have been restored by main loop
   beq MouseInputNoFreshPots
MouseInputReadPots:
   lda #1
   sta MousePotSampleValid
   lda #0
   sta MousePotSelectionReady
   lda PadlXReg
   sta MouseNewPotX
   lda PadlYReg
   sta MouseNewPotY
   jmp MouseInputSampleDigital

MouseInputNoFreshPots:
   lda #0
   sta MousePotSampleValid

MouseInputSampleDigital:
   ;Read both controllers while neither CIA port drives the keyboard matrix.
   ;The main loop must use this joystick snapshot, not the KERNAL's idle PRA
   ;or the all-low keyboard rows used below to suppress mouse phantom keys.
   ;A switch on one side can still reach the other through a held key, so a
   ;mouse button suppresses that frame's joystick action. Port-1 controller
   ;activity also blinds the following KERNAL scan so it cannot become a
   ;phantom key. In the two-joystick layout the active-low union lets either
   ;port navigate the desktop.
   lda #0
   sta CIA1_DDRB
   sta CIA1_DDRA
   lda CIA1_RegB
   sta InputPort1Sample
   lda CIA1_RegA
   sta InputPort2Sample

   lda GeosInputLayout
   beq MouseInputLayoutMouse1
   cmp #rpud3InputJoy1Mouse2
   beq MouseInputLayoutMouse2

   ;No mouse: either joystick controls the menu and mouse state remains idle.
   lda InputPort1Sample
   and InputPort2Sample
   ora #%11100000
   sta Joystick2Sample
   lda #$ff
   sta MousePort1Sample
   bne MouseInputRestoreCIA

MouseInputLayoutMouse1:
   lda InputPort1Sample
   sta MousePort1Sample
   lda InputPort2Sample
   jmp MouseInputChooseJoystick

MouseInputLayoutMouse2:
   lda InputPort2Sample
   sta MousePort1Sample
   lda InputPort1Sample
MouseInputChooseJoystick:
   tax
   lda MousePort1Sample
   and #%00011111
   cmp #%00011111
   beq MouseInputJoystickReady
   ldx #$ff
MouseInputJoystickReady:
   stx Joystick2Sample

MouseInputRestoreCIA:
   dec CIA1_DDRA
   lda InputPort1Sample
   and #%00011111
   cmp #%00011111
   bne MouseInputBlindKeyboard
   lda MousePort1Sample
   and #%00011111
   cmp #%00011111
   beq MouseInputNotActive
MouseInputBlindKeyboard:
   dec CIA1_DDRB
   lda #0
   sta CIA1_RegB
MouseInputNotActive:

   lda GeosInputLayout
   cmp #rpud3InputJoy1Joy2
   beq MouseNoMouseConfigured

   lda MousePort1Sample
   and #%00010000
   bne MouseButtonReleasedSample
   lda #1
   bne MouseStoreNewButton
MouseButtonReleasedSample:
   lda #0
MouseStoreNewButton:
   sta MouseNewLeftDown
   jmp MouseInputUpdateMouse

MouseNoMouseConfigured:
   lda #0
   sta MouseNewLeftDown
   sta MouseLeftDown
   sta MouseButtonDebounceCount
   rts

MouseInputUpdateMouse:
   lda MousePotSampleValid
   bne MouseInputUpdatePots
   lda #0
   sta MouseFrameMoved
   jmp MouseUpdatePresence

MouseInputUpdatePots:
   lda MouseCalibrated
   bne MouseSampleMovement
   lda MouseNewPotX
   sta MouseOldPotX
   lda MouseNewPotY
   sta MouseOldPotY
   lda MouseNewLeftDown
   sta MouseLeftDown
   lda #1
   sta MouseCalibrated
   rts

MouseSampleMovement:
   lda #0
   sta MouseFrameMoved

   lda MouseNewPotX
   ldy MouseOldPotX
   jsr Mouse1351DecodeDelta
   bcc MouseSampleY
   sty MouseOldPotX
   sta MouseDelta
   jsr Mouse1351ApplyX
   jsr Mouse1351MarkPlausibleMovement

MouseSampleY:
   lda MouseNewPotY
   ldy MouseOldPotY
   jsr Mouse1351DecodeDelta
   bcc MouseUpdatePresence
   sty MouseOldPotY
   sta MouseDelta
   jsr Mouse1351ApplyY
   jsr Mouse1351MarkPlausibleMovement

MouseUpdatePresence:
   lda MouseActive
   bne MouseActiveButtonEdge

   lda MouseFrameMoved
   beq MouseResetMotionScore
   inc MouseMotionScore
   lda MouseMotionScore
   cmp #MouseMotionActivateFrames
   bcc MouseCheckActivationClick
   lda #1
   sta MouseActive
   lda #0
   sta MouseMotionScore
   sta MouseButtonScore
   jmp MouseStoreButtonState

MouseResetMotionScore:
   lda #0
   sta MouseMotionScore

MouseCheckActivationClick:
   lda MouseNewLeftDown
   beq MouseResetButtonScore
   inc MouseButtonScore
   lda MouseButtonScore
   cmp #MouseClickActivateFrames
   bcc MouseStoreButtonState
   lda #1
   sta MouseActive
   lda #0
   sta MouseMotionScore
   sta MouseButtonScore
   jmp MouseStoreButtonState

MouseResetButtonScore:
   lda #0
   sta MouseButtonScore
   jmp MouseStoreButtonState

MouseActiveButtonEdge:
   ;Require two agreeing IRQ samples for either edge. A single noisy low
   ;must not select an icon, and a single noisy high must not re-arm a held
   ;press. Keep MouseLeftDown stable for the drag/release path as well.
   lda MouseNewLeftDown
   cmp MouseLeftDown
   beq MouseButtonDebounceReset
   inc MouseButtonDebounceCount
   lda MouseButtonDebounceCount
   cmp #MouseButtonDebounceFrames
   bcc MouseButtonDebounceDone
   lda MouseNewLeftDown
   beq MouseButtonDebounceCommit
   lda MouseMenuEnabled
   beq MouseButtonDebounceCommit
   lda #1
   sta MouseClickEdge
MouseButtonDebounceCommit:
   lda MouseNewLeftDown
   sta MouseLeftDown
MouseButtonDebounceReset:
   lda #0
   sta MouseButtonDebounceCount
MouseButtonDebounceDone:
   rts

MouseStoreButtonState:
   lda MouseNewLeftDown
   sta MouseLeftDown
   rts

; A=current POT value, Y=last accepted value.  Carry set returns a signed
; logical delta in A and the new baseline in Y.  Carry clear rejects no motion
; and the +/- one-count SID noise bit, retaining the previous baseline.
Mouse1351DecodeDelta:
   sty MouseOldValue
   sta MouseNewValue
   sec
   sbc MouseOldValue
   and #%01111111
   cmp #%01000000
   bcs MouseDecodeNegative
   lsr
   beq MouseDecodeRejected
   ldy MouseNewValue
   sec
   rts

MouseDecodeNegative:
   ora #%11000000
   cmp #$ff
   beq MouseDecodeRejected
   sec
   ror
   ldy MouseNewValue
   sec
   rts

MouseDecodeRejected:
   lda #0
   clc
   rts

Mouse1351ApplyX:
   lda MouseDelta
   bmi MouseApplyXNegative
   clc
   adc MouseLogicalX
   cmp #MouseLogicalXMax+1
   bcc MouseStoreX
   lda #MouseLogicalXMax
MouseStoreX:
   sta MouseLogicalX
   rts
MouseApplyXNegative:
   clc
   adc MouseLogicalX
   bcs MouseStoreX
   lda #0
   sta MouseLogicalX
   rts

; The 1351 Y counter grows upward, opposite the screen coordinate direction.
Mouse1351ApplyY:
   lda MouseDelta
   eor #$ff
   clc
   adc #1
   bmi MouseApplyYNegative
   clc
   adc MouseLogicalY
   cmp #MouseLogicalYMax+1
   bcc MouseStoreY
   lda #MouseLogicalYMax
MouseStoreY:
   sta MouseLogicalY
   rts
MouseApplyYNegative:
   clc
   adc MouseLogicalY
   bcs MouseStoreY
   lda #0
   sta MouseLogicalY
   rts

Mouse1351MarkPlausibleMovement:
   lda MouseDelta
   bpl MouseMovementAbsoluteReady
   eor #$ff
   clc
   adc #1
MouseMovementAbsoluteReady:
   cmp #MousePlausibleDeltaLimit
   bcs MouseMovementMarkDone
   lda #1
   sta MouseFrameMoved
MouseMovementMarkDone:
   rts

; One-color GEOS-style arrow, copied to aligned VIC-bank-0 tape-buffer RAM.
MousePointerSpriteData:
   !byte %10000000,0,0
   !byte %11000000,0,0
   !byte %11100000,0,0
   !byte %11110000,0,0
   !byte %11111000,0,0
   !byte %11111100,0,0
   !byte %11111110,0,0
   !byte %11111111,0,0
   !byte %11111100,0,0
   !byte %11001100,0,0
   !byte %10000110,0,0
   !byte %00000110,0,0
   !byte %00000011,0,0
   !byte %00000011,0,0
   !byte 0,0,0
   !byte 0,0,0
   !byte 0,0,0
   !byte 0,0,0
   !byte 0,0,0
   !byte 0,0,0
   !byte 0,0,0
   !byte 0

MouseCalibrated:       !byte 0
MouseActive:           !byte 0
MouseMenuEnabled:      !byte 0
MouseMotionScore:      !byte 0
MouseButtonScore:      !byte 0
MouseFrameMoved:       !byte 0
MouseLogicalX:         !byte 80
MouseLogicalY:         !byte 100
MouseOldPotX:          !byte 0
MouseOldPotY:          !byte 0
MouseNewPotX:          !byte 0
MouseNewPotY:          !byte 0
MouseOldValue:         !byte 0
MouseNewValue:         !byte 0
MouseDelta:            !byte 0
MousePort1Sample:      !byte $ff
Joystick2Sample:       !byte $ff
InputPort1Sample:      !byte $ff
InputPort2Sample:      !byte $ff
GeosInputLayout:       !byte rpud3InputMouse1Joy2
GeosInputPendingLayout: !byte rpud3InputMouse1Joy2
MousePotSelectionReady: !byte 0
MousePotSampleValid:    !byte 0
MouseNewLeftDown:      !byte 0
MouseLeftDown:         !byte 0
MouseButtonDebounceCount: !byte 0
MouseClickEdge:        !byte 0
MouseFrameClick:       !byte 0
MouseFrameDown:        !byte 0
MouseFrameX:           !byte 80
MouseFrameY:           !byte 100
MousePhysicalXLo:      !byte 0
MousePhysicalXHi:      !byte 0
MouseOpenArmed:        !byte 0
MouseLastClickedItem:  !byte 0
MouseHitItem:          !byte 0
