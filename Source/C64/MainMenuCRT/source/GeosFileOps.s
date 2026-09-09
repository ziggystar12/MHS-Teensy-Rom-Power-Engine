; SD/USB file operations. The Teensy owns the volatile clipboard and captures
; the delete target before this dialog can send its separate confirmation.
; A modal loop consumes navigation and never dispatches remote launches.
GeosFileCopy:
   lda #rCtlFileCopyWAIT
   bne GeosFileStart
GeosFilePaste:
   lda #rCtlFilePasteWAIT
   bne GeosFileStart
GeosFileDelete:
   lda #rCtlFileDeletePrepareWAIT
GeosFileStart:
   pha
   lda GeosSurfaceMode
   cmp #GeosSurfaceBrowser
   beq +
   jmp GeosFileWrongSurface
+
   lda rWRegCurrMenuWAIT+IO1Port
   cmp #rmtTeensy
   bcc +
   jmp GeosFileWrongSurface
+
   lda rwRegCursorItemOnPg+IO1Port
   sta rwRegSelItemOnPage+IO1Port
   pla
   sta wRegControl+IO1Port
   jsr WaitForTRWaitMsg
   lda #$ff
   sta GeosFileLastState
GeosFileLoop:
   lda rRegFileOpState+IO1Port
   cmp GeosFileLastState
   beq GeosFilePoll
   sta GeosFileLastState
   jsr GeosFileDraw
GeosFilePoll:
   lda GeosFileLastState
   cmp #rfosBusy
   bne GeosFileReadInput
   lda rRegFileOpProgress+IO1Port
   cmp GeosFileLastProgress
   beq GeosFileReadInput
   sta GeosFileLastProgress
   jsr GeosRichBegin
   jsr GeosFileMessage
   jsr GeosDialogPublish
GeosFileReadInput:
   jsr GeosDialogPoll
   beq GeosFileLoop
   cmp #2
   beq GeosFileConfirm
   jsr GeosFileCancel
   bcc GeosFileLoop
   lda #0
   sta MouseClickEdge
   sta MouseOpenArmed
   sta GeosMouseWasDown
   jmp GeosShellRedraw
GeosFileWrongSurface:
   pla
   lda #GeosNoticeFileScope
   jmp GeosShellSetNotice

; Keep the backend's captured target and recheck its live state immediately
; before confirming. Shared modal input alone cannot authorize a stale target.
GeosFileConfirm:
   lda rRegFileOpState+IO1Port
   cmp #rfosDeleteReady
   bne GeosFileLoop
   lda #rCtlFileDeleteConfirmWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRWaitMsg
   jmp GeosFileLoop
GeosFileCancel:
   lda GeosFileLastState
   cmp #rfosBusy
   beq +
   cmp #rfosDeleteReady
   beq +
   sec
   rts
+  lda #rCtlFileCancel
   sta wRegControl+IO1Port
   clc
   rts

GeosFileDraw:
   lda #<GeosDialogDeleteText
   sta GeosDialogAction
   lda #>GeosDialogDeleteText
   sta GeosDialogAction+1
   ldx #0
   lda GeosFileLastState
   cmp #rfosDeleteReady
   bne +
   ldx #1
+  cmp #rfosBusy
   bne +
   ldx #3
+  txa
   jsr GeosDialogOpen
   lda #<GeosFileTitle
   ldy #>GeosFileTitle
   jsr GeosDialogBegin
   lda #rsstFileOpName
   jsr GeosDialogSerial
   jsr GeosFileMessage
   jsr GeosDialogPublish
   lda #$ff
   sta GeosFileLastProgress
   rts
GeosFileMessage:
   jsr GeosDialogStatus
   lda #rsstFileOpMessage
   jsr GeosDialogSerial
   lda GeosFileLastState
   cmp #rfosBusy
   bne +
   lda #<GeosFileProgressRect
   ldy #>GeosFileProgressRect
   jsr UiLoadRect
   jsr UiFrame
   lda rRegFileOpProgress+IO1Port
   cmp #101
   bcc ++
   lda #100
++ asl
   beq +
   sta RichW
   lda #60
   sta RichX
   lda #134
   sta RichY
   lda #3
   sta RichH
   lda #$ff
   sta RichInk
   jsr RichRect
+  rts

!convtab raw {
GeosFileProgressRect: !byte 58,0,132,204,0,7
GeosFileTitle: !tx "File operation",0
GeosFileLastState: !byte 0
GeosFileLastProgress: !byte 0

}
