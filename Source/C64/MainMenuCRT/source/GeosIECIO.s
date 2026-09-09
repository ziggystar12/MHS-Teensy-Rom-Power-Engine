; Small C64-side IEC directory reader. No Teensy menu-source changes or file
; writes: devices 8/9 are accessed through the public KERNAL channel API.
;
; GeosIECReadPage inputs: GeosIECDevice (8/9), GeosIECTopLo/Hi item offset.
; Outputs: Count (0..16), Total (full count), More (another entry exists), Error (0=OK,
; 1=device/I/O/DOS error, 2=malformed/limit/STOP), Title[17] (zero terminated),
; Entries[16*20]: zero-padded name[16], type initial, blocks low/high, DIR flag.
; The DIR flag is 1 only for the exact DIR suffix, distinguishing it from DEL.
;
; GeosIECChangeDir inputs: Device, CommandLength, Command[32] containing only
; CD:name or CD:<left-arrow>. It returns Error and DOSStatus (first two digits).
; Both calls return A=Error, C clear on success, and close only their own LFN.
;
; Parser work is bounded to 32 KiB and 96 text bytes per directory line. STOP
; is checked between reads. Stock KERNAL IEC handshakes contain IRQ-masked,
; unbounded hardware waits: these limits cannot abort a physically stuck bus.

   GeosIECPageSize = DesktopViewportItems
   GeosIECRecordSize = 20
   GeosIECKernalREADST = $ffb7
   GeosIECKernalSETLFS = $ffba
   GeosIECKernalSETNAM = $ffbd
   GeosIECKernalOPEN = $ffc0
   GeosIECKernalCLOSE = $ffc3
   GeosIECKernalCHKIN = $ffc6
   GeosIECKernalCLRCHN = $ffcc
   GeosIECKernalCHRIN = $ffcf
   GeosIECKernalSTOP = $ffe1

GeosIECReadPage:
   lda #0
   sta GeosIECTotalLo
   sta GeosIECTotalHi
   lda #1
   bne GeosIECReadMode
GeosIECReadViewport:
   lda #0
GeosIECReadMode:
   sta GeosIECCountAll
   lda #0
   sta GeosIECCount
   sta GeosIECMore
   ldx #16
GeosIECClearTitle:
   sta GeosIECTitle,x
   dex
   bpl GeosIECClearTitle
   lda #2
   jsr GeosIECBegin
   bcc +
   jmp GeosIECReadDone
+
   lda GeosIECTopLo
   sta GeosIECSkipLo
   lda GeosIECTopHi
   sta GeosIECSkipHi
GeosIECSkipReady:
   lda #<GeosIECEntries
   sta GeosIECStoreEntry+1
   lda #>GeosIECEntries
   sta GeosIECStoreEntry+2
   lda #1
   sta GeosIECHeaderPending
   ldx #<GeosIECDollar
   ldy #>GeosIECDollar
   jsr GeosIECKernalSETNAM
   lda #2
   ldx GeosIECDevice
   ldy #0
   jsr GeosIECKernalSETLFS
   jsr GeosIECOpenInput
   bcc +
   jmp GeosIECReadDone
+
   ;The serial directory is a BASIC program stream, including its load word.
   jsr GeosIECGetByte
   bcc +
   jmp GeosIECReadTruncated
+  jsr GeosIECGetByte
   bcc +
   jmp GeosIECReadTruncated
+
GeosIECNextLine:
   jsr GeosIECGetByte
   bcc GeosIECLineLinkLow
   lda GeosIECError
   bne GeosIECReadDone
   lda GeosIECHeaderPending
   beq GeosIECReadDone       ;EOI at a complete record boundary is valid.
   jmp GeosIECReadTruncated
GeosIECLineLinkLow:
   sta GeosIECLinkLo
   jsr GeosIECGetByte
   bcc +
   jmp GeosIECReadTruncated
+  ora GeosIECLinkLo
   bne GeosIECReadLine
   lda GeosIECHeaderPending
   beq GeosIECReadDone
   jmp GeosIECReadTruncated

GeosIECReadDone:
   lda GeosIECError
   beq +
   lda #0                  ;Never expose a partial page as a complete result.
   sta GeosIECCount
   sta GeosIECMore
+  lda GeosIECSelection
   cmp GeosIECCount
   bcc +
   lda GeosIECCount
   beq ++
   sec
   sbc #1
++ sta GeosIECSelection
+  jmp GeosIECCleanup

GeosIECReadTruncated:
   lda GeosIECError
   bne GeosIECReadDone
   lda #2
   sta GeosIECError
   bne GeosIECReadDone

GeosIECReadLine:
   lda #0
   sta GeosIECQuoteState
   sta GeosIECNameLength
   sta GeosIECTypeLength
   ldx #GeosIECRecordSize-1
GeosIECClearRecord:
   sta GeosIECRecord,x
   dex
   bpl GeosIECClearRecord
   lda #96
   sta GeosIECLineRemaining
   jsr GeosIECGetByte
   bcs GeosIECReadTruncated
   sta GeosIECRecord+17
   jsr GeosIECGetByte
   bcs GeosIECReadTruncated
   sta GeosIECRecord+18
GeosIECReadText:
   jsr GeosIECGetByte
   bcs GeosIECReadTruncated
   cmp #0
   beq GeosIECFinishLine
   dec GeosIECLineRemaining
   bmi GeosIECReadTruncated
   ldx GeosIECQuoteState
   beq GeosIECFindQuote
   cpx #1
   beq GeosIECReadName
   ;Only the first three letters following the closing quote are needed.
   ldx GeosIECTypeLength
   cpx #3
   bcs GeosIECReadText
   and #$7f
   cmp #$41
   bcc GeosIECReadText
   cmp #$5b
   bcs GeosIECReadText
   sta GeosIECTypeLetters,x
   inc GeosIECTypeLength
   bne GeosIECReadText
GeosIECFindQuote:
   cmp #$22
   bne GeosIECReadText
   inc GeosIECQuoteState
   bne GeosIECReadText
GeosIECReadName:
   cmp #$22
   beq GeosIECEndName
   ldx GeosIECNameLength
   cpx #16
   bcs GeosIECReadTruncated ;Do not navigate using a silently truncated name.
   sta GeosIECRecord,x
   inc GeosIECNameLength
   bne GeosIECReadText
GeosIECEndName:
   inc GeosIECQuoteState
   bne GeosIECReadText

GeosIECBadLine:
   jmp GeosIECReadTruncated

GeosIECFinishLine:
   lda GeosIECQuoteState
   cmp #1
   beq GeosIECBadLine
   ldx GeosIECHeaderPending
   beq GeosIECFileLine
   cmp #2
   bne GeosIECBadLine
   ldx #15
GeosIECCopyTitle:
   lda GeosIECRecord,x
   sta GeosIECTitle,x
   dex
   bpl GeosIECCopyTitle
   lda #0
   sta GeosIECHeaderPending
   jmp GeosIECNextLine
GeosIECFileLine:
   cmp #2
   beq +
   jmp GeosIECNextLine      ;The BLOCKS FREE line has no quoted filename.
+  lda GeosIECNameLength
   beq GeosIECBadLine
   lda GeosIECTypeLength
   beq GeosIECBadLine
   lda GeosIECTypeLetters
   sta GeosIECRecord+16
   cmp #$44                ;D
   bne GeosIECEntryReady
   lda GeosIECTypeLength
   cmp #3
   bne GeosIECEntryReady
   lda GeosIECTypeLetters+1
   cmp #$49                ;I
   bne GeosIECEntryReady
   lda GeosIECTypeLetters+2
   cmp #$52                ;R
   bne GeosIECEntryReady
   lda #1
   sta GeosIECRecord+19
GeosIECEntryReady:
   jsr GeosIECRecordIsParent
   bcc +
   jmp GeosIECNextLine     ; Parent navigation already has a window control.
+
   lda GeosIECCountAll
   beq +
   inc GeosIECTotalLo
   bne +
   inc GeosIECTotalHi
+
   lda GeosIECSkipLo
   ora GeosIECSkipHi
   beq GeosIECKeepEntry
   lda GeosIECSkipLo
   bne +
   dec GeosIECSkipHi
+  dec GeosIECSkipLo
   jmp GeosIECNextLine
GeosIECKeepEntry:
   lda GeosIECCount
   cmp #GeosIECPageSize
   bcc GeosIECCopyEntry
   lda #1
   sta GeosIECMore
   lda GeosIECCountAll
   beq +
   jmp GeosIECNextLine
+
   jmp GeosIECReadDone
GeosIECCopyEntry:
   ldx #GeosIECRecordSize-1
GeosIECCopyEntryByte:
   lda GeosIECRecord,x
GeosIECStoreEntry:
   sta $ffff,x
   dex
   bpl GeosIECCopyEntryByte
   clc
   lda GeosIECStoreEntry+1
   adc #GeosIECRecordSize
   sta GeosIECStoreEntry+1
   bcc +
   inc GeosIECStoreEntry+2
+  inc GeosIECCount
   jmp GeosIECNextLine

; Only exact parent DIR names are omitted. Ordinary files called ".." and
; directories such as "..GAMES" stay visible. Filter before the page skip count.
GeosIECRecordIsParent:
   lda GeosIECRecord+19
   beq GeosIECNotParent
   ldx #0
   lda GeosIECRecord
   cmp #'/'
   bne +
   inx
+  lda GeosIECRecord,x
   cmp #'.'
   bne GeosIECNotParent
   inx
   lda GeosIECRecord,x
   cmp #'.'
   bne GeosIECNotParent
   inx
   lda GeosIECRecord,x
   cmp #' '
   bne GeosIECParentPadding
   lda GeosIECRecord+1,x
   cmp #'<'
   bne GeosIECParentPadding
   ldy #0
GeosIECParentSuffix:
   lda GeosIECRecord,x
   and #$7f
   cmp #$61
   bcc +
   cmp #$7b
   bcs +
   and #$5f
+
   cmp GeosIECParentText,y
   bne GeosIECNotParent
   inx
   iny
   cpy #9
   bne GeosIECParentSuffix
GeosIECParentPadding:
   cpx #16
   beq GeosIECIsParent
   lda GeosIECRecord,x
   beq +
   cmp #' '
   beq +
   cmp #$a0
   bne GeosIECNotParent
+  inx
   bne GeosIECParentPadding
GeosIECIsParent:
   sec
   rts
GeosIECNotParent:
   clc
   rts
GeosIECParentText: !byte $20,$3c,$55,$50,$20,$44,$49,$52,$3e

GeosIECChangeDir:
   lda #3
   jsr GeosIECBegin
   bcc +
   jmp GeosIECCleanup
+  lda GeosIECCommandLength
   cmp #4
   bcc GeosIECBadCommand
   cmp #33
   bcs GeosIECBadCommand
   ;Only directory changes are accepted, never arbitrary DOS commands.
   lda GeosIECCommand
   and #$7f
   cmp #$43                ;C
   bne GeosIECBadCommand
   lda GeosIECCommand+1
   and #$7f
   cmp #$44                ;D
   bne GeosIECBadCommand
   lda GeosIECCommand+2
   cmp #$3a                ;:
   bne GeosIECBadCommand
   ldx #3
GeosIECCheckCommandText:
   lda GeosIECCommand,x
   cmp #$20                ;Reject embedded NUL/CR or other command controls.
   bcc GeosIECBadCommand
   inx
   cpx GeosIECCommandLength
   bcc GeosIECCheckCommandText
   lda GeosIECCommandLength
   ldx #<GeosIECCommand
   ldy #>GeosIECCommand
   jsr GeosIECKernalSETNAM
   lda #3
   ldx GeosIECDevice
   ldy #15
   jsr GeosIECKernalSETLFS
   jsr GeosIECOpenInput
   bcs GeosIECCommandDone
   jsr GeosIECReadStatusDigit
   bcs GeosIECCommandDone
   sta GeosIECDOSStatus
   asl
   asl
   clc
   adc GeosIECDOSStatus
   asl
   sta GeosIECDOSStatus
   jsr GeosIECReadStatusDigit
   bcs GeosIECCommandDone
   clc
   adc GeosIECDOSStatus
   sta GeosIECDOSStatus
   cmp #20
   bcc GeosIECCommandDone
   lda #1
   sta GeosIECError
GeosIECCommandDone:
   jmp GeosIECCleanup
GeosIECBadCommand:
   lda #2
   sta GeosIECError
   bne GeosIECCommandDone

GeosIECReadStatusDigit:
   jsr GeosIECGetByte
   bcc +
   lda GeosIECError
   bne GeosIECStatusBad
   beq GeosIECStatusMalformed
+  cmp #$30
   bcc GeosIECStatusMalformed
   cmp #$3a
   bcs GeosIECStatusMalformed
   sec
   sbc #$30
   clc
   rts
GeosIECStatusMalformed:
   lda #2
   sta GeosIECError
GeosIECStatusBad:
   sec
   rts

; A=our LFN. Retain the existing IRQ/keyboard service, but prevent arbitrary
; SID code from touching KERNAL scratch state during serial transactions.
GeosIECBegin:
   sta GeosIECLogicalFile
   lda smcSIDPauseStop+1
   sta GeosIECSavedSID
   lda #1
   sta smcSIDPauseStop+1
   lda $9d                 ;Suppress KERNAL error text on the bitmap surface.
   sta GeosIECSavedMessages
   lda #0
   sta $9d
   sta GeosIECError
   sta GeosIECEOF
   sta GeosIECBytesLo
   sta GeosIECBytesHi
   sta GeosIECOpenAttempted
   sta GeosIECDOSStatus
   lda GeosIECDevice
   cmp #8
   beq GeosIECCheckLogicalFile
   cmp #9
   bne GeosIECIOError
GeosIECCheckLogicalFile:
   ;Do not close someone else's LFN if OPEN would fail with FILE OPEN.
   lda GeosIECLogicalFile
   ldx $98                 ;KERNAL logical-file table length.
   beq GeosIECBeginReady
   cpx #11
   bcs GeosIECIOError
GeosIECFindLogicalFile:
   dex
   cmp $0259,x
   beq GeosIECIOError
   cpx #0
   bne GeosIECFindLogicalFile
GeosIECBeginReady:
   clc
   rts

GeosIECOpenInput:
   ;OPEN may allocate the table entry before returning DEVICE NOT PRESENT.
   lda #1
   sta GeosIECOpenAttempted
   jsr GeosIECKernalOPEN
   bcs GeosIECIOError
   jsr GeosIECKernalREADST
   bne GeosIECIOError
   ldx GeosIECLogicalFile
   jsr GeosIECKernalCHKIN
   bcs GeosIECIOError
   jsr GeosIECKernalREADST
   bne GeosIECIOError
   clc
   rts
GeosIECIOError:
   lda #1
   sta GeosIECError
   sec
   rts

; C clear returns one valid byte, including the byte carrying EOI. A later
; call returns C set with EOF set; all other READST bits are genuine errors.
GeosIECGetByte:
   lda GeosIECEOF
   bne GeosIECNoByte
   jsr GeosIECKernalSTOP
   beq GeosIECLimitOrStop
   lda GeosIECBytesHi
   bmi GeosIECLimitOrStop
   inc GeosIECBytesLo
   bne +
   inc GeosIECBytesHi
+  jsr GeosIECKernalCHRIN
   sta GeosIECReadValue
   bcs GeosIECIOError
   jsr GeosIECKernalREADST
   sta GeosIECReadStatus
   and #$bf
   bne GeosIECIOError
   lda GeosIECReadStatus
   and #$40
   sta GeosIECEOF
   lda GeosIECReadValue
   clc
   rts
GeosIECLimitOrStop:
   lda #2
   sta GeosIECError
GeosIECNoByte:
   sec
   rts

GeosIECCleanup:
   jsr GeosIECKernalCLRCHN
   lda GeosIECOpenAttempted
   beq +
   lda GeosIECLogicalFile
   jsr GeosIECKernalCLOSE
+  jsr GeosIECKernalCLRCHN
   lda GeosIECSavedMessages
   sta $9d
   lda GeosIECSavedSID
   sta smcSIDPauseStop+1
   lda GeosIECError
   beq +
   sec
   rts
+  clc
   rts

GeosIECDevice:             !byte 8
GeosIECTopLo:              !byte 0
GeosIECTopHi:              !byte 0
GeosIECTotalLo:            !byte 0
GeosIECTotalHi:            !byte 0
GeosIECCountAll:           !byte 0
GeosIECCount:              !byte 0
GeosIECMore:               !byte 0
GeosIECError:              !byte 0
GeosIECDOSStatus:          !byte 0
GeosIECCommandLength:      !byte 0
GeosIECTitle:              !fill 17,0
GeosIECEntries:            !fill GeosIECPageSize*GeosIECRecordSize,0
GeosIECCommand:            !fill 32,0

GeosIECDollar:             !byte $24
GeosIECRecord:             !fill GeosIECRecordSize,0
GeosIECTypeLetters:        !fill 3,0
GeosIECLogicalFile:        !byte 0
GeosIECOpenAttempted:      !byte 0
GeosIECSavedSID:           !byte 0
GeosIECSavedMessages:      !byte 0
GeosIECEOF:                !byte 0
GeosIECBytesLo:            !byte 0
GeosIECBytesHi:            !byte 0
GeosIECSkipLo:             !byte 0
GeosIECSkipHi:             !byte 0
GeosIECHeaderPending:      !byte 0
GeosIECLinkLo:             !byte 0
GeosIECQuoteState:         !byte 0
GeosIECNameLength:         !byte 0
GeosIECTypeLength:         !byte 0
GeosIECLineRemaining:      !byte 0
GeosIECReadValue:          !byte 0
GeosIECReadStatus:         !byte 0
GeosIECIOEnd:
