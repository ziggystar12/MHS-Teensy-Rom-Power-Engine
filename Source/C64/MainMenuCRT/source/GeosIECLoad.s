; Launch the selected IEC PRG without returning into an overwritten desktop.
; KERNAL LOAD uses secondary address 1 (the file's own load address).
; https://github.com/mist64/cbmsrc/blob/master/KERNAL_C64_03/load
; The loader, name, device and launch metadata all relocate to the tape buffer.

; File/SHIFT-RUNSTOP boot from an IEC browser. A selected folder or disk image
; is entered first; an ordinary file selection still boots the current disk.
; The existing directory-change path refreshes records before any error redraw.
GeosIECBootSelection:
   lda GeosIECSelection
   cmp GeosIECCount
   bcs GeosIECBootCurrent
   jsr GeosIECGetEntry
   jsr GeosIECEntryIsDirectory
   bcc GeosIECBootCurrent
   jsr GeosIECEnterDirectory
   lda GeosIECError
   bne GeosIECBootDone
GeosIECBootCurrent:
   lda GeosIECDevice
; A=8 or 9, supplied by the selected home drive or the current IEC browser.
; Keep the surface and directory records untouched if the preflight fails.
; This is LOAD "*",device,1 followed by RUN for a BASIC-address boot program.
GeosIECBootDisk:
   sta GeosIECDevice
   lda #'*'
   sta GeosIECEntry
   lda #1
   sta GeosIECLaunchNameLength
   jmp GeosIECLaunchPreflight
GeosIECBootDone:
   rts

GeosIECLaunchPRG:
   ldx #15
-  lda GeosIECEntry,x
   beq +
   cmp #$a0
   beq +
   cmp #' '
   bne GeosIECLaunchNameReady
+  dex
   bpl -
   rts
GeosIECLaunchNameReady:
   inx
   stx GeosIECLaunchNameLength
GeosIECLaunchPreflight:
   ;Read the address before abandoning the UI; errors still redraw the browser.
   lda #2
   jsr GeosIECBegin
   bcs GeosIECLaunchReadDone
   lda GeosIECLaunchNameLength
   ldx #<GeosIECEntry
   ldy #>GeosIECEntry
   jsr GeosIECKernalSETNAM
   lda #2
   ldx GeosIECDevice
   ldy #2
   jsr GeosIECKernalSETLFS
   jsr GeosIECOpenInput
   bcs GeosIECLaunchReadDone
   jsr GeosIECGetByte
   bcs GeosIECLaunchBadAddress
   sta GeosIECLaunchAddress
   jsr GeosIECGetByte
   bcs GeosIECLaunchBadAddress
   sta GeosIECLaunchAddress+1
   cmp #8                    ;protect the tape loader and KERNAL workspace
   bcc GeosIECLaunchBadAddress
   lda GeosIECEOF             ;a two-byte header alone is not a program
   beq GeosIECLaunchReadDone
GeosIECLaunchBadAddress:
   lda #2
   sta GeosIECError
GeosIECLaunchReadDone:
   jsr GeosIECCleanup
   bcc GeosIECLaunchPrepare
   ; Also works when Boot Disk was invoked on a home drive icon. Do not turn
   ; a home failure into an IEC view containing another drive's old records.
   lda #0
   sta MouseOpenArmed
   lda #<MsgIECError
   ldy #>MsgIECError
   jmp GeosIECShowStatus

GeosIECLaunchPrepare:
   jsr Mouse1351Hide
   jsr IRQDisable
   jsr TextScreenMemColor
   ;Same KERNAL/BASIC initialization as the existing Teensy PRG launch path.
   ;Do this before copying the tape loader, because RAMTAS clears page $03.
   sei
   cld
   jsr $ff84                 ;IOINIT
   lda #0
   tay
-  sta $0002,y
   sta $0200,y
   sta $0300,y
   iny
   bne -
   ldx #0
   ldy #$a0
   jsr $fd8c                 ;remaining RAMTAS initialization, no RAM test
   jsr $ff8a                 ;RESTOR
   jsr $ff81                 ;CINT
   cli
   jsr $e453                 ;BASIC vectors
   jsr $e3bf                 ;BASIC RAM
   jsr $e422                 ;BASIC startup display
   ldx #0
-  lda GeosIECLaunchImage,x
   sta PRGLoadStartReloc,x
   inx
   cpx #GeosIECLaunchImageEnd-GeosIECLaunchImage
   bne -
   ldx #15
-  lda GeosIECEntry,x
   sta GeosIECLoadName,x
   dex
   bpl -
   lda GeosIECLaunchNameLength
   sta GeosIECLoadNameLength
   lda GeosIECDevice
   sta GeosIECLoadDevice
   lda GeosIECLaunchAddress
   sta GeosIECLoadAddress
   lda GeosIECLaunchAddress+1
   sta GeosIECLoadAddress+1
   jsr GeosIECReleaseCartridge
   jmp GeosIECLoadLaunch

; A separate entry keeps the hardware-free preview testable. Use the generic
; next IO handler, never the stale selected Teensy file's handler association.
GeosIECReleaseCartridge:
   lda #rCtlVanishROM
   sta wRegControl+IO1Port
   lda #rCtlRunningIEC
   sta wRegControl+IO1Port
-  lda rRegIOHSwapPoll+IO1Port
   cmp #rihsReady
   bne -
   rts

GeosIECLaunchNameLength: !byte 0
GeosIECLaunchAddress: !word 0
GeosIECLaunchImage:
!pseudopc PRGLoadStartReloc {
GeosIECLoadLaunch:
   ldx #$fb
   txs                       ;discard all menu callers before LOAD replaces them
   lda GeosIECLoadNameLength
   ldx #<GeosIECLoadName
   ldy #>GeosIECLoadName
   jsr $ffbd                 ;SETNAM
   lda #1
   ldx GeosIECLoadDevice
   ldy #1
   jsr $ffba                 ;SETLFS: load to the address stored in the PRG
   lda #0
   jsr $ffd5                 ;LOAD: all post-load instructions stay below $0400
   bcs GeosIECLoadError
   stx $2d
   sty $2e
   stx $ae
   sty $af
   lda GeosIECLoadAddress+1
   cmp #8
   bne GeosIECLoadMachineCode
   lda GeosIECLoadAddress
   cmp #1
   bne GeosIECLoadMachineCode
   jsr $a659                 ;CLR / reset execution
   jsr $a533                 ;relink BASIC lines, including SYS boot stubs
   lda GeosIECLoadDevice
   sta $ba                   ;retain device 9 for programs that load more files
   jmp $a7ae                 ;RUN
GeosIECLoadMachineCode:
   lda #<GeosIECLoadSYSMessage
   ldy #>GeosIECLoadSYSMessage
   bne GeosIECLoadMessage
GeosIECLoadError:
   lda #<GeosIECLoadErrorMessage
   ldy #>GeosIECLoadErrorMessage
GeosIECLoadMessage:
   jsr $ab1e
   jmp (BasicWarmStartVect)
GeosIECLoadSYSMessage: !text 13,"loaded - use sys to start",13,0
GeosIECLoadErrorMessage: !text 13,"load failed",13,0
GeosIECLoadNameLength: !byte 0
GeosIECLoadDevice: !byte 8
GeosIECLoadAddress: !word 0
GeosIECLoadName: !fill 16,0
}
GeosIECLaunchImageEnd:
!if GeosIECLaunchImageEnd-GeosIECLaunchImage > 192 {
   !error "IEC loader exceeds the tape buffer"
}
