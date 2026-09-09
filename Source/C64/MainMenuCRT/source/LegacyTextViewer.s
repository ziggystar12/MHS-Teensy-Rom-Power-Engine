; Shared classic text viewer; desktop stores this in resident app RAM.
ViewTextFileImpl:
   jsr PrintBanner ;OptionColor
   lda TblEscC+EscOptionColor
   sta $0286  ;set text color

   jsr StartSelItem_WaitForTRDots ;Tell Teensy to check file and prep for xfer

   lda rRegStrAvailable+IO1Port ;Ready to read?
   bne +
   jsr AnyKeyMsgWait
   jmp EndReturn

smcPauseForTextInfo
+  lda #0
   beq +
   lda #0 ;reset to non-pause default
   sta smcPauseForTextInfo+1
   jsr AnyKeyMsgWait

+  lda TblEscC+EscNameColor ;(light green currently) Default for text files
   sta $0286  ;set text color

NewPage
   lda #ChrClear
   jsr SendChar

PrintLoop
   lda rRegStrAvailable+IO1Port ;are we done?
   beq EOPWait   ;End of File
   ;sec
   ;jsr SetCursor ;read current to load x (row) & y (col)
   ldx $d6  ;X now contains Cursor physical line number
   lda rRegStreamData+IO1Port ;read from rRegStreamData+IO1Port increments address & checks for end

;   ; Check for clear as EOP marker, if not on first line (0):
;   cmp #ChrClear ;special case for clear character
;   bne +
;   cpx #0   ;still on First line?
;   bne EOPWait ; If not, don't display it now, will clear on NewPage

   ; last line checks for last col or return char (to include most of last line)
+  cpx #24  ;on last line?
   bne +
   ldy $d3 ;Cursor Column on current line (0-79)
   cpy #39
   beq EOPWait ; dropping char(!)
   cmp #ChrReturn  ;Check for return on the last line (Before sending it)
   beq EOPWait ;  Don't display it/scroll, will clear on NewPage
+  jsr SendChar
   jmp PrintLoop

;   ; optionally, just check for last line and don't print there
;+  jsr SendChar
;   cpx #24  ;on last line?
;   bne PrintLoop

   ;end of page or file:
EOPWait
   jsr CheckForIRQGetIn
   beq EOPWait

;key pressed...
   cmp #ChrF1  ;f1 to abort
   beq EndReturn
   cmp #ChrStop  ;Stop to abort
   beq EndReturn

+  cmp #ChrReturn ;next page, then exit
   bne +
   ldx rRegStrAvailable+IO1Port ;are we done?
   bne NewPage   ;more to read, print next page
   jmp EndReturn

+  cmp #ChrSpace ;next page, then next text file
   bne +
   ldx rRegStrAvailable+IO1Port ;are we done?
   bne NewPage   ;more to read, print next page
   lda #rCtlNextTextFile
   jmp LoadViewTxt

+  cmp #'+'
   bne +
   lda #rCtlNextTextFile
   jmp LoadViewTxt

+  cmp #'-'
   bne +
   lda #rCtlLastTextFile
LoadViewTxt
   sta wRegControl+IO1Port
   jmp ViewTextFile

+  cmp #ChrCRSRUp
   bne +
   inc BackgndColorReg
   jmp EOPWait

+  cmp #ChrCRSRDn
   bne +
   dec BackgndColorReg
   jmp EOPWait

+  cmp #ChrCRSRLeft
   bne +
   inc BorderColorReg
   jmp EOPWait

+  cmp #ChrCRSRRight
   bne +
   dec BorderColorReg
   jmp EOPWait

+  cmp #'r'  ;re-load
   bne +
   jmp ViewTextFile

+  cmp #'i'  ;reload and pause to view info
   bne +
   lda #1 ;flag to pause after load
   sta smcPauseForTextInfo+1
   jmp ViewTextFile

+  cmp #ChrF4  ;Toggle Music now
   bne +
   jsr ToggleSIDMusic
   ;jmp EOPWait

+  jmp EOPWait    ;all other keys ignored

EndReturn
   jmp TextScreenMemColor  ;return from there
   ;rts
