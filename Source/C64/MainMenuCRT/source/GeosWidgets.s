; Shared monochrome bitmap controls. Rectangles use the six contiguous bytes
; RichX, RichXHi, RichY, RichW, RichWHi, RichH. All dimensions are physical
; pixels; callers provide nonempty in-screen bounds. No IRQ/bank/publication
; changes here: compose under GeosRichBegin and publish pixels before colors.

UiPublishRect = $c010

; A/Y = six-byte rectangle descriptor. No zero page is borrowed from SID.
UiLoadRect:
   sta UiRectRead+1
   sty UiRectRead+2
   ldx #5
UiRectRead:
   lda $ffff,x
   sta RichX,x
   dex
   bpl UiRectRead
   rts

; Preserve geometry around destructive RichRect. Shared scratch is synchronous
; drawing state, never referenced by the SID/mouse IRQ.
UiSaveRect:
   ldx #5
-  lda RichX,x
   sta UiRect,x
   dex
   bpl -
   rts
UiRestoreRect:
   ldx #5
-  lda UiRect,x
   sta RichX,x
   dex
   bpl -
   rts

; One-pixel black keyline, explicitly cleared white interior. Preserves the
; input rectangle and normalizes each touched staged color cell to black/white.
UiFrame:
   jsr UiSaveRect
   lda #$ff
   sta RichInk
   jsr RichRect
   jsr UiFrameColors
   jsr UiRestoreRect
   jsr UiInset
   lda #0
   sta RichInk
   jsr RichRect
   jmp UiRestoreRect

UiInset:
   inc RichX
   bne +
   inc RichXHi
+  inc RichY
   sec
   lda RichW
   sbc #2
   sta RichW
   lda RichWHi
   sbc #0
   sta RichWHi
   dec RichH
   dec RichH
   rts

; RichRect already computed inclusive first/last columns without dropping a
; partial right cell. Compute row bounds once, never once per painted cell.
UiFrameColors:
   jsr UiRowBounds
   jmp UiColorRow
UiRowBounds:
   lda UiRect+2
   lsr
   lsr
   lsr
   sta RichColorRow
   lda UiRect+2
   clc
   adc UiRect+5
   sec
   sbc #1
   lsr
   lsr
   lsr
   sta RichColorLast
   rts
UiColorRow:
   ldx RichColorRow
   lda TblGeosBitmapScreenRowLo,x
   sta UiColorWrite+1
   lda TblGeosBitmapScreenRowHi,x
   clc
   adc #>(GeosLayoutScreen-C64ScreenRAM)
   sta UiColorWrite+2
   ldy RichStartCol
   lda GeosBitmapColor
UiColorWrite:
   sta $ffff,y
   cpy RichEndCol
   iny
   bcc UiColorWrite
   inc RichColorRow
   lda RichColorLast
   cmp RichColorRow
   bcs UiColorRow
   rts

; Publish color pairs only after every requested bitmap pixel is installed.
; Partial edge cells keep their outside pixels, but VIC color pairs are cells.
UiPublishColors:
   jsr UiRowBounds
UiPublishColorRow:
   ldx RichColorRow
   lda TblGeosBitmapScreenRowLo,x
   sta UiPublishedColorRead+1
   sta UiPublishedColorWrite+1
   lda TblGeosBitmapScreenRowHi,x
   sta UiPublishedColorWrite+2
   clc
   adc #>(GeosLayoutScreen-C64ScreenRAM)
   sta UiPublishedColorRead+2
   ldy RichStartCol
UiPublishedColorRead:
   lda $ffff,y
UiPublishedColorWrite:
   sta $ffff,y
   cpy RichEndCol
   iny
   bcc UiPublishedColorRead
   inc RichColorRow
   lda RichColorLast
   cmp RichColorRow
   bcs UiPublishColorRow
   rts

; Same title height and close position in browsers, apps and modal dialogs.
; Body starts y+18. The caller draws the title at x+4,y+4.
UiWindow:
   jsr UiFrame
   jsr UiInset
   lda RichY
   clc
   adc #15
   sta RichY
   lda #1
   sta RichH
   lda #$ff
   sta RichInk
   jsr RichRect
   jsr UiRestoreRect
   jsr UiCloseGeometry
   jmp UiClose

; Shared drawing and hit rectangle: right inset3, top inset2, size11x11.
UiWindowCloseHit:
   jsr UiCloseGeometry
UiHit:
   jmp RichHitRect
UiCloseGeometry:
   clc
   lda RichX
   adc RichW
   sta RichX
   lda RichXHi
   adc RichWHi
   sta RichXHi
   sec
   lda RichX
   sbc #14
   sta RichX
   lda RichXHi
   sbc #0
   sta RichXHi
   inc RichY
   inc RichY
   lda #11
   sta RichW
   sta RichH
   lda #0
   sta RichWHi
   rts

; An authored seven-pixel X, not a letter or PETSCII graphics character.
; UiFrame clears the complete interior before the masked bitmap is applied.
UiClose:
   jsr UiFrame
   jsr UiInset
   jsr UiInset
   lda #<UiCloseArt
   ldy #>UiCloseArt
UiGlyph:
   sta RichSource+1
   sty RichSource+2
   lda #1
   sta RichBytes
   lda #7
   sta RichH
   lda #$ff
   sta RichInk
   jmp RichBlit

; A=0 normal or1 selected/default. Geometry preserved; RichInk is the text
; color on return. Labels use the same native5x7 font at caller-chosen inset.
UiButton:
   sta UiSelected
   jsr UiFrame
   lda UiSelected
   beq UiButtonNormal
   jsr UiInset
   lda #$ff
   sta RichInk
   jsr RichRect
   jsr UiRestoreRect
   lda #0
   beq UiButtonInk
UiButtonNormal:
   lda #$ff
UiButtonInk:
   sta RichInk
   rts

; A bit0 is the check state. A bit7 marks a disabled control; its stippled
; interior gives a monochrome disabled cue while preserving a visible border.
UiCheckbox:
   and #$81
   sta UiSelected
   jsr UiFrame
   lda UiSelected
   beq UiCheckboxDone
   jsr UiInset
   jsr UiInset
   lda #<UiCheckArt
   ldy #>UiCheckArt
   bit UiSelected
   bpl +
   lda #<UiDisabledArt
   ldy #>UiDisabledArt
+  jmp UiGlyph
UiCheckboxDone:
   rts

; Vertical scroll bar with 11px arrow targets and an independently positioned
; thumb. Browser state owns absolute BrowserThumbY/H in the inset track.
UiScrollbar:
   jsr UiFrame
   jsr UiInset
   lda RichY
   clc
   adc #10
   sta RichY
   lda #1
   sta RichH
   lda #$ff
   sta RichInk
   jsr RichRect
   lda UiRect+2
   clc
   adc UiRect+5
   sec
   sbc #12
   sta RichY
   lda #1
   sta RichH
   jsr RichRect
   jsr UiRestoreRect
   lda RichX
   clc
   adc #3
   sta RichX
   bcc +
   inc RichXHi
+  lda RichY
   clc
   adc #4
   sta RichY
   lda #<UiUpArt
   ldy #>UiUpArt
   jsr UiGlyph
   lda UiRect+2
   clc
   adc UiRect+5
   sec
   sbc #7
   sta RichY
   lda #<UiDownArt
   ldy #>UiDownArt
   jsr UiGlyph
   jsr UiRestoreRect
   jsr UiInset
   lda BrowserThumbY
   sta RichY
   lda BrowserThumbH
   sta RichH
   lda #$ff
   sta RichInk
   jmp RichRect

UiCloseArt: !byte $82,$44,$28,$10,$28,$44,$82
UiUpArt: !byte $20,$70,$f8,0,0,0,0
UiDownArt: !byte $f8,$70,$20,0,0,0,0
UiCheckArt: !byte $08,$10,$a0,$40,0,0,0
UiDisabledArt: !byte $a8,$50,$a8,$50,$a8,0,0
UiRect: !fill 6,0
UiSelected: !byte 0
