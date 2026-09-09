; Shared detailed SID controls; desktop stores these in resident app RAM.
ShowSIDAdvancedImpl:
   jsr PrintBanner ;SourcesColor
   lda #<MsgSIDInfo1
   ldy #>MsgSIDInfo1
   jsr PrintString

   lda #rsstSIDInfo
   jsr PrintSerialString

   lda #<MsgSIDInfo2
   ldy #>MsgSIDInfo2
   jsr PrintString

   lda #rsstMachineInfo
   jsr PrintSerialString

   lda #<MsgSIDInfo3
   ldy #>MsgSIDInfo3
   jsr PrintString

   lda #<MsgSpaceRet
   ldy #>MsgSpaceRet
   jsr PrintString

   ;page identifier for check from interrupt
   lda TblEscC+EscBackgndColor
   sta PageIdentifyColor
   lda #PILSIDScreen
   sta PageIdentifyLoc

   jsr PrintSongNum
   jsr PrintVoiceMutes

PrintSIDVars:
   jsr PrintSIDSpeed

WaitSIDInfoKey:
   jsr DisplayTime
   jsr CheckForIRQGetIn
   beq WaitSIDInfoKey

+  cmp #ChrCRSRLeft  ;decrease SID speed (small step)
   bne +
   lda #rsscDecMinor
SendSpeedChangeUpdate
   sta wRegSIDSpeedChange+IO1Port
   jsr SetSidSpeedToCurrent
   jmp PrintSIDVars

+  cmp #ChrCRSRRight  ;increase SID speed (small step)
   bne +
   lda #rsscIncMinor
   jmp SendSpeedChangeUpdate

+  cmp #ChrCRSRUp  ;increase SID speed (big step)
   bne +
   lda #rsscIncMajor
   jmp SendSpeedChangeUpdate

+  cmp #ChrCRSRDn  ;decrease SID speed (big step)
   bne +
   lda #rsscDecMajor
   jmp SendSpeedChangeUpdate

+  cmp #'l'  ;Toggle Log/Lin speed control
   bne +
   lda #rsscToggleLogLin
   jmp SendSpeedChangeUpdate

+  cmp #'d'  ;Set SID speed to default
   bne +
   jsr SetSIDSpeedToDefault
   jmp PrintSIDVars

+  cmp #'1'  ;Voice #1 mute toggle
   bne +
   lda #%00000001
VoiceMuteTogle
   eor smcVoicesMuted+1
   sta smcVoicesMuted+1
   jsr PrintVoiceMutes
   jmp WaitSIDInfoKey

+  cmp #'2'  ;Voice #2 mute toggle
   bne +
   lda #%00000010
   jmp VoiceMuteTogle

+  cmp #'3'  ;Voice #3 mute toggle
   bne +
   lda #%00000100
   jmp VoiceMuteTogle

+  cmp #'+'  ;next song in SID
   bne +
   ldx rwRegSIDSongNumZ+IO1Port
   cpx rRegSIDNumSongsZ+IO1Port
   bne ++
   ldx #$ff  ;roll over
++ inx
   stx rwRegSIDSongNumZ+IO1Port
   jsr SIDSongInit
   jsr PrintSongNum ;Reprint song num/num songs
   jmp WaitSIDInfoKey

+  cmp #'-'  ;prev song in SID
   bne +
   ldx rwRegSIDSongNumZ+IO1Port
   bne ++
   ldx rRegSIDNumSongsZ+IO1Port ;roll under
   inx
++ dex
   stx rwRegSIDSongNumZ+IO1Port
   jsr SIDSongInit
   jsr PrintSongNum ;Reprint song num/num songs
   jmp WaitSIDInfoKey

+  cmp #ChrF4  ;toggle music
   bne +
-  jsr ToggleSIDMusic
   jmp WaitSIDInfoKey
+  cmp #'p'  ;toggle music
   beq -

+  cmp #'b'  ;Toggle Border effect
   bne +
   lda smcBorderEffect+1
   eor #1
   sta smcBorderEffect+1
   jmp WaitSIDInfoKey

+  cmp #'s'  ;Set current SID as default/background
   bne +
   lda #rCtlSetBackgroundSIDWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRWaitMsg
   ldx #22 ;row
   ldy #33 ;col
   clc
   jsr SetCursor
   lda #<MsgDone
   ldy #>MsgDone
   jsr PrintString
   jmp WaitSIDInfoKey

+  cmp #ChrF1  ;Teensy mem Menu
   beq ++
   cmp #ChrSpace  ;back to Main Menu
   beq ++
   jmp WaitSIDInfoKey
++ rts
