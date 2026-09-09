!src "source/LegacyTextViewer.s"
!src "source/LegacySIDInfo.s"

; RichItem identifies an already composed 72x9 control label. The caller has
; exposed native RAM under BASIC; copy only its exact pixels and color cells.
AppPublishControlLabel:
   jsr GeosPanelControlOrigin
   lda RichX
   sec
   sbc #24
   sta RichX
   lda RichY
   clc
   adc #19
   sta RichY
   lda #72
   sta RichW
   lda #9
   sta RichH
   jmp AppPublishRect

; Copy exactly the requested pixels, including partial first/last byte and
; top/bottom character cells.
AppPublishRect:
   jsr UiSaveRect
   jsr RichRectBounds
AppPublishRow:
   jsr RichAddress
   lda RichRead+1
   sta AppWidgetRead+1
   sta AppWidgetVisible+1
   sta AppWidgetWrite+1
   lda RichRead+2
   sta AppWidgetRead+2
   eor #$80
   sta AppWidgetVisible+2
   sta AppWidgetWrite+2
   lda RichEndCol
   sec
   sbc RichStartCol
   sta RichColumns
   tax
   lda RichFirstMask
   cpx #0
   bne +
   and RichLastMask
+  jsr AppPublishByte
   txa
   beq AppPublishNextRow
AppPublishColumn:
   clc
   lda AppWidgetRead+1
   adc #8
   sta AppWidgetRead+1
   sta AppWidgetVisible+1
   sta AppWidgetWrite+1
   bcc +
   inc AppWidgetRead+2
   inc AppWidgetVisible+2
   inc AppWidgetWrite+2
+  dec RichColumns
   lda #$ff
   ldx RichColumns
   bne +
   lda RichLastMask
+  jsr AppPublishByte
   txa
   bne AppPublishColumn
AppPublishNextRow:
   inc RichY
   dec RichH
   bne AppPublishRow
   jmp UiPublishColors
AppPublishByte:
   sta RichMask
AppWidgetVisible:
   lda $ffff
   sta RichBits
AppWidgetRead:
   eor $ffff
   and RichMask
   eor RichBits
AppWidgetWrite:
   sta $ffff
   rts

; A=new home icon, different from the selected icon. Reuse the authored label
; renderer with live pixel mirroring and restore mirror/bank/IRQ state.
AppSelectHome:
   ldx GeosHomeSelection
   stx RichItem
   sta GeosHomeSelection
   php
   sei
   jsr GeosRichBegin
   lda #$ea
   sta RichMirrorMode
   jsr RichHomeOrigin
   jsr RichHomeLabelStart
   lda GeosHomeSelection
   sta RichItem
   jsr RichHomeOrigin
   jsr RichHomeLabelStart
   lda #$60
   sta RichMirrorMode
   lda RichSavedBank
   sta $01
   plp
   rts
