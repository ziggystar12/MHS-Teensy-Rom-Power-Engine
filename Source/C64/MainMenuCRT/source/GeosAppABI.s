; Fixed $c000 desktop ABI. Every utility bank repeats these vectors so closing
; a loaded app leaves the desktop's shared calls valid.
   jmp AppEnter
AppBackendAvailable: !byte 1

   jmp ViewTextFileImpl          ;$c004: classic text viewer
   jmp ShowSIDAdvancedImpl       ;$c007: detailed SID controls
   jmp AppPublishControlLabel    ;$c00a: bounded live control-label publication
   jmp AppSelectHome             ;$c00d: live home labels and footer
   jmp AppPublishRect            ;$c010: exact bitmap rectangle, then colors

; Fixed desktop ABI used only while the resident firmware preflight dialog is
; active. Continue returns carry set. STOP, a fresh click, or ten complete
; 29-tenth activity sweeps cancels the backend and returns carry clear.
AppWaitPoll:                     ;$c013
AppWaitArmed:
   lda #0                        ;$c014 is the resident-controlled operand
   beq AppWaitContinue
   lda GeosBitmapWaitCol
   beq AppWaitCancel
   jsr GetIn
   cmp #ChrStop
   beq AppWaitCancel
   lda MouseClickEdge
   bne AppWaitCancel
AppWaitContinue:
   sec
   rts
AppWaitCancel:
   lsr AppWaitArmed+1
   lda #rCtlFirmwareCancel
   clc
   rts
