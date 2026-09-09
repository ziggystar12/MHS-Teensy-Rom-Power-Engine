; Expanded GEOS-inspired shell.  This module is compiled only into the
; PROGMEM DesktopShell PRG; the resident 8 KiB cartridge remains a compact
; bootstrap/recovery menu.

   GeosSurfaceHome = 0
   GeosSurfaceBrowser = 1
   GeosSurfaceIEC = 2

   GeosOverlayNone = 0
   GeosOverlayMenu = 1
   GeosOverlayControl = 2
   GeosOverlayArrange = 3
   GeosOverlayAbout = 4
   GeosOverlayNotice = 5

   GeosMenuDesk = 0
   GeosMenuFile = 1
   GeosMenuEdit = 2
   GeosMenuView = 3
   GeosMenuDisk = 4
   GeosMenuCount = 5

   GeosHomeIconCount = 8
   GeosHomeSlotCount = 15
   GeosControlItemCount = 9

   GeosNoticeNone = 0
   GeosNoticeAbout = 1
   GeosNoticeFirmware = 2
   GeosNoticeSaved = 3
   GeosNoticeFileScope = 4

   GeosHomeIconFirst = $5c
   GeosHomeIconChip = GeosHomeIconFirst
   GeosHomeIconSD = GeosHomeIconChip+4
   GeosHomeIconUSB = GeosHomeIconSD+4
   GeosHomeIconDrive = GeosHomeIconUSB+4
   GeosHomeIconFolder = GeosHomeIconDrive+4
   GeosHomeIconControl = GeosHomeIconFolder+4

; ---------------------------------------------------------------------------
; Shell state and initialization

GeosShellInit:
   lda rwRegPwrUpDefaults3+IO1Port
   and #rpud3AppearanceDark+rpud3BackgroundMask
   sta GeosAppearancePrefs
   and #rpud3BackgroundMask
   cmp #rpud3BackgroundInvalid
   bne +
   lda GeosAppearancePrefs
   and #$ff-rpud3BackgroundMask
   sta GeosAppearancePrefs
+  lda rwRegPwrUpDefaults3+IO1Port
   and #rpud3TextMenu
   eor #1
   sta GeosViewMode
   lda #GeosSurfaceHome
   sta GeosSurfaceMode
   lda #0
   sta GeosOverlayMode
   sta GeosActiveMenu
   sta GeosMenuSelection
   sta GeosHomeSelection
   sta GeosControlSelection
   sta GeosNotice
   sta GeosDragActive
   sta GeosMouseWasDown
   lda #$ff
   sta GeosDragCandidate

   ;Load eight icon positions; the old ninth EEPROM slot stays reserved.
   ldx #0
GeosLoadSlots:
   lda rwRegDesktopSlotStart+IO1Port,x
   cmp #GeosHomeSlotCount
   bcs GeosUseDefaultSlots
   sta GeosWorkSlot
   txa
   beq GeosStoreSlot
   tay
GeosCheckDuplicateSlot:
   dey
   lda TblGeosHomeIconSlot,y
   cmp GeosWorkSlot
   beq GeosUseDefaultSlots
   tya
   bne GeosCheckDuplicateSlot
GeosStoreSlot:
   lda GeosWorkSlot
   sta TblGeosHomeIconSlot,x
   inx
   cpx #GeosHomeIconCount
   bne GeosLoadSlots
   rts

GeosUseDefaultSlots:
   ldx #0
GeosDefaultSlotLoop:
   txa
   sta TblGeosHomeIconSlot,x
   inx
   cpx #GeosHomeIconCount
   bne GeosDefaultSlotLoop
   rts

GeosShellEnterBrowser:
   lda #GeosSurfaceBrowser
   sta GeosSurfaceMode
   lda #GeosOverlayNone
   sta GeosOverlayMode
   lda #GeosNoticeNone
   sta GeosNotice
   lda #$ff
   sta GeosDragCandidate
   rts

GeosShellUsesLocalSelection:
   lda GeosViewMode
   beq GeosShellSelectionIsBackend
   lda GeosOverlayMode
   bne GeosShellSelectionIsLocal
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   beq GeosShellSelectionIsLocal
   lda GeosSurfaceMode
   bne GeosShellSelectionIsBackend
GeosShellSelectionIsLocal:
   sec
   rts
GeosShellSelectionIsBackend:
   clc
   rts

GeosShellMouseSelectionValue:
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne +
   lda GeosMenuSelection
   rts
+  cmp #GeosOverlayControl
   bne +
   lda GeosControlSelection
   rts
+  cmp #GeosOverlayArrange
   beq GeosMouseSelectionHome
   lda GeosSurfaceMode
   bne +
GeosMouseSelectionHome:
   lda GeosHomeSelection
   rts
+  cmp #GeosSurfaceIEC
   bne +
   lda GeosIECSelection
   rts
+  lda rwRegCursorItemOnPg+IO1Port
   rts

; ---------------------------------------------------------------------------
; Home desktop and browser chrome

;The native compositor draws Home directly; the former layout hook is a no-op.
GeosShellDrawHome = GeosInstallMonoCharset
GeosShellDrawBrowserHeader = GeosBrowserCaptureHeader

GeosShellDrawBrowserFooter:
   ;CHRCLR already cleared the layout. Do not write 40 chars on row 24:
   ;the KERNAL would scroll the title/path out of this off-screen layout.
   ;One bitmap-native F-key strip is drawn after layout. No duplicate toolbar.

; ---------------------------------------------------------------------------
; Menu and Control Panel drawing

GeosShellDrawOverlay:
   ;Pixel-native overlays are composed after the off-screen browser layout.
   rts
GeosShellRedraw:
   jmp ListMenuItems

; The backend page map omits its synthetic parent only in bitmap/icon view.
; Its raw directory entries remain available to the compact/classic list.
GeosSyncMenuView:
   lda GeosViewMode
   beq +
   lda #2
+
   cmp rwRegMenuView+IO1Port
   beq +
   sta rwRegMenuView+IO1Port
   jsr WaitForTRWaitMsg
+  rts

; ---------------------------------------------------------------------------
; Unified keyboard/joystick action routing

GeosShellHandleKey:
   sta GeosShellKey
   and #$7f
   cmp #'v'
   beq GeosShellUnmanagedKey
   lda GeosViewMode
   bne +
GeosShellUnmanagedKey:
   jmp GeosShellKeyNotHandled
+
   lda GeosOverlayMode
   cmp #GeosOverlayNotice
   bne +
   jmp GeosShellCloseOverlayKey
+  lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bne +
   jmp GeosShellAboutKey
+  lda GeosOverlayMode
   cmp #GeosOverlayControl
   bne +
   lda GeosShellKey
   jmp GeosPanelControlHandleKey
+  lda GeosOverlayMode
   bne GeosShellAfterFileKeys
   lda GeosShellKey
   cmp #ChrRun
   bne +
   jsr GeosFileBootDisk
   jmp GeosShellKeyHandled
+
   cmp #'C'
   bne +
   jsr GeosFileCopy
   jmp GeosShellKeyHandled
+  cmp #'P'
   bne +
   jsr GeosFilePaste
   jmp GeosShellKeyHandled
+  cmp #'D'
   bne GeosShellAfterFileKeys
   jsr GeosFileDelete
   jmp GeosShellKeyHandled
GeosShellAfterFileKeys:
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   lda GeosShellKey
   jsr GeosIECHandleKey
   bcc +
   jmp GeosShellKeyHandled
+
   lda GeosShellKey
   cmp #MouseEventMenuDesk
   bcc GeosShellCheckStop
   cmp #MouseEventMenuDisk+1
   bcs GeosShellCheckStop
   sec
   sbc #MouseEventMenuDesk
   jsr GeosShellOpenMenu
   jmp GeosShellKeyHandled

GeosShellCheckStop:
   lda GeosShellKey
   cmp #ChrHome
   bne +
   jsr GeosFileDesktop
   jmp GeosShellKeyHandled
+  lda GeosShellKey
   cmp #ChrStop
   beq GeosShellBackOrMenu
   cmp #ChrRun
   beq GeosShellBackOrMenu
   cmp #ChrF8
   beq GeosShellKeyControl
   cmp #ChrUpArrow
   bne GeosShellKeyNotHandled
   lda GeosOverlayMode
   beq GeosShellKeyNotHandled
GeosShellCloseOverlayKey:
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne +
   jsr GeosShellCloseMenu
   jmp GeosShellKeyHandled
+
   cmp #GeosOverlayArrange
   bne +
   jsr GeosShellCancelArrange
   jmp GeosShellKeyHandled
+  lda #GeosOverlayNone
   sta GeosOverlayMode
   sta GeosNotice
   jsr GeosShellRedraw
   jmp GeosShellKeyHandled

GeosShellBackOrMenu:
   lda GeosOverlayMode
   bne GeosShellCloseOverlayKey
   lda GeosSurfaceMode
   beq +
   jsr GeosFileDesktop
   jmp GeosShellKeyHandled
+
   lda #GeosMenuDesk
   jsr GeosShellOpenMenu
   jmp GeosShellKeyHandled

GeosShellKeyControl:
   jsr GeosShellOpenControl
GeosShellKeyHandled:
   lda GeosShellKey
   sec
   rts
GeosShellKeyNotHandled:
   lda GeosShellKey
   clc
   rts

; Keep shortcuts from acting on the file window beneath the About panel.
GeosShellAboutKey:
   lda GeosShellKey
   cmp #ChrReturn
   beq GeosShellAboutCloseKey
   cmp #ChrStop
   beq GeosShellAboutCloseKey
   cmp #ChrRun
   beq GeosShellAboutCloseKey
   cmp #ChrSpace
   beq GeosShellAboutCloseKey
   jmp GeosShellKeyHandled
GeosShellAboutCloseKey:
   jmp GeosShellCloseOverlayKey

GeosShellOpenMenu:
   tax
   lda GeosOverlayMode
   pha
   stx GeosActiveMenu
   lda #0
   sta GeosMenuSelection
   sta GeosNotice
   lda #GeosOverlayMenu
   sta GeosOverlayMode
   pla
   cmp #GeosOverlayControl
   bcc +
   jmp GeosShellRedraw
+
   jmp GeosMenuRedraw

GeosShellCloseMenu:
   lda #GeosOverlayNone
   sta GeosOverlayMode
   sta GeosNotice
   jmp GeosMenuRedraw

; A=clicked header. Only the currently open menu toggles closed; a different
; header switches directly, including when another kind of panel was open.
GeosShellToggleMenu:
   tax
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne GeosShellToggleMenuOpen
   cpx GeosActiveMenu
   bne GeosShellToggleMenuOpen
   jmp GeosMouseCloseOverlay
GeosShellToggleMenuOpen:
   txa
   jmp GeosShellOpenMenu

GeosShellOpenControl:
   lda #0
   sta GeosControlMode
GeosControlOpen:
   ; Close the file window before opening settings. Compose Home locally:
   ; the menu-bar mouse path must not re-enter directory/serial-string work.
   lda #GeosSurfaceHome
   sta GeosSurfaceMode
   lda #GeosOverlayControl
   sta GeosOverlayMode
   lda #0
   sta GeosControlSelection
   sta GeosNotice
   sta MouseOpenArmed
   jmp GeosBitmapConvertScreen

GeosShellCursorUp:
   lda GeosViewMode
   bne +
   jmp GeosShellCursorBackend
+
   lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bcc +
   sec
   rts
+
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMenuItemUp
+
   cmp #GeosOverlayControl
   bne +
   jmp GeosPanelControlItemUp
+
   cmp #GeosOverlayArrange
   bne +
   jmp GeosArrangeMoveUp
+
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jsr GeosIECMoveUp
   sec
   rts
+  lda GeosSurfaceMode
   beq +
   jmp GeosShellCursorBackend
+
   jsr GeosHomeMoveUp
   sec
   rts

GeosShellCursorDown:
   lda GeosViewMode
   bne +
   jmp GeosShellCursorBackend
+
   lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bcc +
   sec
   rts
+
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMenuItemDown
+
   cmp #GeosOverlayControl
   bne +
   jmp GeosPanelControlItemDown
+
   cmp #GeosOverlayArrange
   bne +
   jmp GeosArrangeMoveDown
+
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jsr GeosIECMoveDown
   sec
   rts
+  lda GeosSurfaceMode
   beq +
   jmp GeosShellCursorBackend
+
   jsr GeosHomeMoveDown
   sec
   rts

GeosShellCursorLeft:
   lda GeosViewMode
   bne +
   jmp GeosShellCursorBackend
+
   lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bcc +
   sec
   rts
+
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMenuPrevious
+
   cmp #GeosOverlayControl
   bne +
   jmp GeosPanelControlItemLeft
+
   cmp #GeosOverlayArrange
   bne +
   jmp GeosArrangeMoveLeft
+
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jsr GeosIECMoveLeft
   sec
   rts
+  lda GeosSurfaceMode
   beq +
   jmp GeosShellCursorBackend
+
   jsr GeosHomeMoveLeft
   sec
   rts

GeosShellCursorRight:
   lda GeosViewMode
   bne +
   jmp GeosShellCursorBackend
+
   lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bcc +
   sec
   rts
+
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMenuNext
+
   cmp #GeosOverlayControl
   bne +
   jmp GeosPanelControlItemRight
+
   cmp #GeosOverlayArrange
   bne +
   jmp GeosArrangeMoveRight
+
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jsr GeosIECMoveRight
   sec
   rts
+  lda GeosSurfaceMode
   beq +
   jmp GeosShellCursorBackend
+
   jsr GeosHomeMoveRight
   sec
   rts
GeosShellCursorBackend:
   clc
   rts

GeosMenuItemUp:
   lda GeosMenuSelection
   bne +
   ldx GeosActiveMenu
   lda TblGeosMenuCount,x
   sta GeosMenuSelection
+  dec GeosMenuSelection
   jsr GeosMenuRedraw
   sec
   rts

GeosMenuItemDown:
   inc GeosMenuSelection
   ldx GeosActiveMenu
   lda GeosMenuSelection
   cmp TblGeosMenuCount,x
   bcc +
   lda #0
   sta GeosMenuSelection
+  jsr GeosMenuRedraw
   sec
   rts

GeosMenuPrevious:
   lda GeosActiveMenu
   bne +
   lda #GeosMenuCount
   sta GeosActiveMenu
+  dec GeosActiveMenu
   lda #0
   sta GeosMenuSelection
   jsr GeosMenuRedraw
   sec
   rts

GeosMenuNext:
   inc GeosActiveMenu
   lda GeosActiveMenu
   cmp #GeosMenuCount
   bcc +
   lda #0
   sta GeosActiveMenu
+  lda #0
   sta GeosMenuSelection
   jsr GeosMenuRedraw
   sec
   rts

; ---------------------------------------------------------------------------
; Home selection, opening, and snap-grid arrangement

GeosHomeMoveRight:
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   sta GeosWorkSlot
   lda #GeosHomeSlotCount
   sta GeosWorkCount
GeosHomeRightLoop:
   inc GeosWorkSlot
   lda GeosWorkSlot
   cmp #GeosHomeSlotCount
   bcc +
   lda #0
   sta GeosWorkSlot
+  lda GeosWorkSlot
   jsr GeosHomeSlotToIcon
   bcs GeosHomeMoveFound
   dec GeosWorkCount
   bne GeosHomeRightLoop
   rts

GeosHomeMoveLeft:
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   sta GeosWorkSlot
   lda #GeosHomeSlotCount
   sta GeosWorkCount
GeosHomeLeftLoop:
   lda GeosWorkSlot
   bne +
   lda #GeosHomeSlotCount
   sta GeosWorkSlot
+  dec GeosWorkSlot
   lda GeosWorkSlot
   jsr GeosHomeSlotToIcon
   bcs GeosHomeMoveFound
   dec GeosWorkCount
   bne GeosHomeLeftLoop
   rts

GeosHomeMoveUp:
   ldx GeosHomeSelection
   lda #3                    ;skip empty snap rows while keeping the column
   sta GeosWorkCount
   lda TblGeosHomeIconSlot,x
GeosHomeUpLoop:
   tax
   lda TblGeosSlotUp,x
   sta GeosWorkSlot
   jsr GeosHomeSlotToIcon
   bcs GeosHomeMoveFound
   dec GeosWorkCount
   beq GeosHomeVerticalDone
   lda GeosWorkSlot
   jmp GeosHomeUpLoop
GeosHomeVerticalDone:
   rts

GeosHomeMoveDown:
   ldx GeosHomeSelection
   lda #3
   sta GeosWorkCount
   lda TblGeosHomeIconSlot,x
GeosHomeDownLoop:
   tax
   lda TblGeosSlotDown,x
   sta GeosWorkSlot
   jsr GeosHomeSlotToIcon
   bcs GeosHomeMoveFound
   dec GeosWorkCount
   beq GeosHomeVerticalDone
   lda GeosWorkSlot
   jmp GeosHomeDownLoop

GeosHomeMoveFound:
   pha
   lda #GeosNoticeNone
   sta GeosNotice
   pla
   cmp GeosHomeSelection
   beq +
   jsr GeosHomeSelect
+
   rts

; A=slot. Returns C set/A=icon id when occupied.
GeosHomeSlotToIcon:
   sta GeosWorkSlot
   ldx #0
GeosSlotToIconLoop:
   lda TblGeosHomeIconSlot,x
   cmp GeosWorkSlot
   beq +
   inx
   cpx #GeosHomeIconCount
   bne GeosSlotToIconLoop
   clc
   rts
+  txa
   sec
   rts

; A=slot. Returns C set when no icon occupies it.
GeosHomeSlotIsEmpty:
   jsr GeosHomeSlotToIcon
   bcc +
   clc
   rts
+  sec
   rts

GeosShellSelectItem:
   lda GeosViewMode
   beq GeosSelectRawBackend
   lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bcs GeosSelectAbout
   cmp #GeosOverlayMenu
   beq GeosSelectMenu
   cmp #GeosOverlayControl
   beq GeosSelectControl
   cmp #GeosOverlayArrange
   beq GeosSelectArrange
   lda GeosSurfaceMode
   bne GeosSelectBackend
   jsr GeosShellActivateHome
   sec
   rts
GeosSelectMenu:
   jsr GeosShellMenuActivate
   sec
   rts
GeosSelectControl:
   jsr GeosShellLaunchControlPage
   sec
   rts
GeosSelectArrange:
   jsr GeosShellCommitArrange
   sec
   rts
GeosSelectAbout:
   jsr GeosShellAboutCloseKey
   sec
   rts
GeosSelectBackend:
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jsr GeosIECActivate
   sec
   rts
+
GeosSelectRawBackend:
   clc
   rts

GeosShellActivateHome:
   lda GeosHomeSelection
   beq GeosHomeOpenTeensy
   cmp #1
   beq GeosHomeOpenSD
   cmp #2
   beq GeosHomeOpenUSB
   cmp #3
   beq GeosHomeOpenDrive8
   cmp #4
   beq GeosHomeOpenDrive9
   cmp #5
   beq GeosHomeOpenGames
   cmp #6
   beq GeosHomeOpenUtilities
   jmp GeosHomeOpenControl

GeosHomeOpenTeensy:
   lda #rmtTeensy
   jmp GeosShellOpenSource
GeosHomeOpenSD:
   lda #rmtSD
   jmp GeosShellOpenSource
GeosHomeOpenUSB:
   lda #rmtUSBDrive
   jmp GeosShellOpenSource
GeosHomeOpenDrive8:
   lda #8
   jmp GeosIECOpenDrive
GeosHomeOpenDrive9:
   lda #9
   jmp GeosIECOpenDrive
GeosHomeOpenGames:
   lda #0
   jmp GeosShellOpenTeensyFolder
GeosHomeOpenUtilities:
   lda #7
GeosShellOpenTeensyFolder:
   sta GeosFolderIndex
   lda #rmtTeensy
   jsr ListMenuItemsChangeInit
   lda GeosFolderIndex
   sta rwRegCursorItemOnPg+IO1Port
   jsr SelectItem
   rts
GeosHomeOpenControl = GeosShellOpenControl

GeosShellOpenSource = ListMenuItemsChangeInit

GeosShellSetNotice:
   sta GeosNotice
   jmp GeosShellRedraw

GeosShellEnterArrange:
   lda #GeosSurfaceHome
   sta GeosSurfaceMode
   lda #GeosOverlayArrange
   sta GeosOverlayMode
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   sta GeosArrangeOrigin
   jmp GeosShellRedraw

GeosArrangeMoveLeft:
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   tax
   lda TblGeosSlotLeft,x
   jmp GeosArrangeTrySlot
GeosArrangeMoveRight:
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   tax
   lda TblGeosSlotRight,x
   jmp GeosArrangeTrySlot
GeosArrangeMoveUp:
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   tax
   lda TblGeosSlotUp,x
   jmp GeosArrangeTrySlot
GeosArrangeMoveDown:
   ldx GeosHomeSelection
   lda TblGeosHomeIconSlot,x
   tax
   lda TblGeosSlotDown,x

GeosArrangeTrySlot:
   sta GeosWorkSlot
   jsr GeosHomeSlotIsEmpty
   bcc GeosArrangeMoveDone
   ldx GeosHomeSelection
   lda GeosWorkSlot
   sta TblGeosHomeIconSlot,x
   jsr GeosShellRedraw
GeosArrangeMoveDone:
   sec
   rts

GeosShellCommitArrange:
   ldx GeosHomeSelection
   jsr GeosShellPersistIcon
   lda #GeosOverlayNone
   sta GeosOverlayMode
   lda #GeosNoticeSaved
   sta GeosNotice
   jmp GeosShellRedraw

GeosShellCancelArrange:
   ldx GeosHomeSelection
   lda GeosArrangeOrigin
   sta TblGeosHomeIconSlot,x
   lda #GeosOverlayNone
   sta GeosOverlayMode
   jmp GeosShellRedraw

; X=icon id.  One snapped icon move is one existing WAIT-style EEPROM write.
GeosShellPersistIcon:
   lda TblGeosHomeIconSlot,x
   sta rwRegDesktopSlotStart+IO1Port,x
   jmp WaitForTRWaitMsg

; ---------------------------------------------------------------------------
; Menu activation and Settings-page routing

GeosShellMenuActivate:
   jsr GeosShellCloseMenu
   lda GeosActiveMenu
   beq GeosActivateDeskMenu
   cmp #GeosMenuFile
   beq GeosActivateFileMenu
   cmp #GeosMenuEdit
   bne +
   jmp GeosActivateEditMenu
+
   cmp #GeosMenuView
   bne +
   jmp GeosActivateViewMenu
+
   jmp GeosActivateDiskMenu

GeosActivateDeskMenu:
   lda GeosMenuSelection
   cmp #4
   bcc +
   sec
   sbc #4
   jmp GeosShellOpenApp
+  lda GeosMenuSelection
   beq GeosDeskAbout
   cmp #1
   bne +
   jmp GeosHomeOpenControl
+
   cmp #2
   bne +
   jmp GeosMenuRefresh
+
   jmp GeosSetClassicView
GeosDeskAbout:
   lda #GeosOverlayAbout
   sta GeosOverlayMode
   lda #0
   sta MouseOpenArmed
   jmp GeosShellRedraw

GeosShellOpenApp:
   sta GeosAppRequest
   ldx GeosAppBackendAvailable
   beq GeosShellAppReady
   cmp #rdaCount
   bcc +
   lda #rdaTextViewer
+  sta rwRegDesktopAppID+IO1Port
   lda #rCtlDesktopAppLoad
   sta wRegControl+IO1Port
   jsr FastLoadFile
   bne GeosShellAppLoadFailed
   lda GeosAppRequest
GeosShellAppReady:
GeosShellRunLoadedApp:
   jsr GeosAppEntry
   cmp #2
   bne +
   lda #rmtSD
   jmp GeosShellOpenSource
+  jmp GeosShellRedraw
GeosShellAppLoadFailed:
   jmp GeosShellRedraw

GeosActivateFileMenu:
   lda GeosMenuSelection
   cmp #5
   bne +
   jmp GeosFileBootDisk
+
   cmp #4
   bne +
   jmp GeosFileDelete
+  lda GeosMenuSelection
   beq GeosFileOpen
   cmp #1
   beq GeosFileDesktop
   cmp #2
   bne +
   jmp GeosFileParent
+
   lda #rmtSD
   jsr GeosShellOpenSource
   lda #GeosNoticeFirmware
   jmp GeosShellSetNotice
GeosFileOpen:
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jmp GeosIECActivate
+  lda GeosSurfaceMode
   bne +
   jmp GeosShellActivateHome
+  jsr SelectItem
   rts
GeosFileBootDisk:
   lda #0
   sta MouseOpenArmed
   sta GeosOverlayMode
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jmp GeosIECBootSelection
+  cmp #GeosSurfaceHome
   bne GeosBootNeedsDrive
   lda GeosHomeSelection
   sec
   sbc #3
   cmp #2
   bcs GeosBootNeedsDrive
   clc
   adc #8
   jmp GeosIECBootDisk
GeosBootNeedsDrive:
   lda #<MsgBootNeedsDrive
   ldy #>MsgBootNeedsDrive
   jmp GeosIECShowStatus
GeosFileDesktop:
   lda #GeosSurfaceHome
   sta GeosSurfaceMode
   lda #0
   sta GeosOverlayMode
   sta GeosNotice
   sta MouseOpenArmed
   lda #$ff
   sta GeosDragCandidate
   jmp GeosShellRedraw
GeosFileParent:
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jmp GeosIECParent
+  lda GeosSurfaceMode
   beq GeosMenuRefresh
   lda #rCtlUpDirectoryWAIT
   sta wRegControl+IO1Port
   jsr WaitForTRWaitMsg
   jmp GeosShellRedraw

GeosActivateEditMenu:
   lda GeosMenuSelection
   beq GeosEditCopy
   cmp #1
   beq GeosEditPaste
   jmp GeosShellEnterArrange
GeosEditCopy:
   jmp GeosFileCopy
GeosEditPaste:
   jmp GeosFilePaste

GeosActivateViewMenu:
   lda GeosMenuSelection
   beq GeosFileDesktop
   cmp #1
   beq GeosViewIcons
   cmp #2
   beq GeosViewList
GeosMenuRefresh:
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jmp GeosIECRefresh
+
   jmp GeosShellRedraw
GeosViewIcons:
   lda #1
   bne GeosSetViewMode
GeosViewList:
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   jmp GeosShellRedraw
+
GeosSetClassicView:
   lda #GeosSurfaceBrowser
   sta GeosSurfaceMode
   lda #0
GeosSetViewMode:
   sta GeosViewMode
   bne +
   ;The compact list is a recovery UI, so restore normal keyboard scanning
   ;before rendering it or accepting the next cursor key.
   ;Its IRQ no longer updates the desktop joystick snapshot. Do not replay
   ;a direction/fire captured just before the switch ahead of GetIn forever.
   lda #$ff
   sta Joystick2Sample
   jsr Mouse1351RestoreKeyboard
+  lda GeosViewMode
   ;Change only the menu preference; the other startup flags are retained.
   eor #1
   eor rwRegPwrUpDefaults3+IO1Port
   and #rpud3TextMenu
   beq +
   eor rwRegPwrUpDefaults3+IO1Port
   sta rwRegPwrUpDefaults3+IO1Port
   jsr WaitForTRWaitMsg
+
   jmp GeosShellRedraw

GeosActivateDiskMenu:
   lda GeosMenuSelection
   beq GeosDiskTeensy
   cmp #1
   beq GeosDiskSD
   cmp #2
   beq GeosDiskUSB
   cmp #3
   bne +
   jmp GeosHomeOpenDrive8
+
   jmp GeosHomeOpenDrive9
GeosDiskTeensy:
   lda #rmtTeensy
   jmp GeosShellOpenSource
GeosDiskSD:
   lda #rmtSD
   jmp GeosShellOpenSource
GeosDiskUSB:
   lda #rmtUSBDrive
   jmp GeosShellOpenSource

GeosShellLaunchControlPage:
   lda #0
   sta MouseOpenArmed
   lda GeosControlMode
   beq +
   jmp GeosPanelMusicActivate
+  lda GeosControlSelection
   cmp #8
   bne +
   jmp GeosPanelMusicOpen
+
   ;Appearance, Input and Storage are native desktop panels. Their overlay
   ;returns here, then the category window is rebuilt with its selection kept.
   cmp #0
   beq GeosShellLaunchNativeSettings
   cmp #1
   beq GeosShellLaunchNativeSettings
   cmp #3
   beq GeosShellLaunchNativeSettings
   cmp #4
   bne +
   lda #rdaClock
   jmp GeosShellOpenApp
+
   ldx GeosControlSelection
   lda TblGeosControlPage,x
   ora #$80
   sta rwRegScratch+IO1Port
   ldx #9
   lda #1
   jmp DirectRunFromTeensyMenu
GeosShellLaunchNativeSettings:
   jsr GeosPanelSettingsOpen
   jmp GeosShellRedraw

; ---------------------------------------------------------------------------
; Expanded mouse hit testing and drag/drop

; Entered from Mouse1351ProcessMenu with X=character column, Y=character row.
; This routine tail-jumps to the established virtual-key/browser returns.
GeosShellMouseClick:
   lda GeosOverlayMode
   cmp #GeosOverlayAbout
   bne GeosMouseCheckNotice
   lda #<UiAboutWindow
   ldy #>UiAboutWindow
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcs GeosMouseAboutClose
   jmp MouseNoTarget
GeosMouseAboutClose:
   jmp GeosMouseCloseOverlay
GeosMouseCheckNotice:
   cmp #GeosOverlayNotice
   bne GeosMouseOverlayDone
   jmp GeosMouseCloseOverlay
GeosMouseOverlayDone:
   cpy #0
   bne +
   jmp GeosMouseMenuBar
+
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMouseDropdown
+
   cmp #GeosOverlayControl
   bne +
   jmp GeosMouseControl
+
   cmp #GeosOverlayArrange
   bne +
   jmp GeosMouseArrange
+
   lda MouseFrameY
   cmp #189
   bcc +
   lda GeosSurfaceMode
   bne +
   jmp GeosMouseFunctionBar
+
   lda GeosSurfaceMode
   bne +
   jmp GeosMouseHome
+
   lda #<UiBrowserWindow
   ldy #>UiBrowserWindow
   jsr UiLoadRect
   jsr UiWindowCloseHit
   bcc +
   jsr GeosFileDesktop
   jmp MouseNoTarget
+  lda #<UiBrowserParent
   ldy #>UiBrowserParent
   jsr UiLoadRect
   jsr UiHit
   bcc +
   jsr GeosFileParent
   jmp MouseNoTarget
+  lda #<UiBrowserScroll
   ldy #>UiBrowserScroll
   jsr UiLoadRect
   jsr UiHit
   bcs GeosMouseScrollbar
   lda MouseFrameY
   cmp #36
   bcc GeosMouseBrowserNoTarget
   cmp #196
   bcs GeosMouseBrowserNoTarget
   lda GeosSurfaceMode
   cmp #GeosSurfaceIEC
   bne +
   lda MouseFrameX
   lsr
   lsr
   tax
   lda MouseFrameY
   lsr
   lsr
   lsr
   tay
   jmp GeosIECMouseClick
+  jmp MouseHitDesktop
GeosMouseScrollbar:
   lda #0
   sta MouseOpenArmed
   lda MouseFrameY
   cmp #47
   bcc GeosMouseScrollUp
   cmp #189
   bcs GeosMouseScrollDown
   cmp BrowserThumbY
   bcc GeosMouseScrollPageUp
   sec
   sbc BrowserThumbY
   cmp BrowserThumbH
   bcs GeosMouseScrollPageDown
   jsr GeosBrowserDragStart
GeosMouseBrowserNoTarget:
   jmp MouseNoTarget
GeosMouseScrollUp:
   jsr GeosBrowserScrollUp
   jmp MouseNoTarget
GeosMouseScrollDown:
   jsr GeosBrowserScrollDown
   jmp MouseNoTarget
GeosMouseScrollPageUp:
   jsr GeosBrowserPageUp
   jmp MouseNoTarget
GeosMouseScrollPageDown:
   jsr GeosBrowserPageDown
   jmp MouseNoTarget

; Thumb motion composes and publishes only the scroll bar. SID/mouse IRQs keep
; running: this path borrows no zero-page registers and never fetches files.
GeosBrowserDrawScrollbar:
   jsr GeosRichBegin
   lda #<UiBrowserScroll
   ldy #>UiBrowserScroll
   jsr UiLoadRect
   jsr UiScrollbar
   lda #<UiBrowserScroll
   ldy #>UiBrowserScroll
   jsr UiLoadRect
   jsr UiPublishRect
   lda RichSavedBank
   sta $01
   rts

; Match only the visible labels on the single bottom F-key strip.
GeosMouseFunctionBar:
   ldx #0
-  lda MouseFrameX
   cmp RichFunctionHitLeft,x
   bcc +
   cmp RichFunctionHitRight,x
   bcs +
   lda RichFunctionKey,x
   jmp MouseReturnVirtualKey
+  inx
   cpx #RichFunctionCount
   bne -
   jmp MouseNoTarget

GeosMouseMenuBar:
   cpx #6
   bcc GeosMouseOpenDesk
   cpx #10
   bcc GeosMouseOpenFile
   cpx #14
   bcc GeosMouseOpenEdit
   cpx #18
   bcc GeosMouseOpenView
   cpx #22
   bcc GeosMouseOpenDisk
   cpx #28
   bcc GeosMouseDismissMenu
   cpx #30
   bcc GeosMouseToggleSID
   jmp GeosMouseDismissMenu
GeosMouseOpenDesk:
   lda #GeosMenuDesk
   jmp GeosMouseOpenMenu
GeosMouseOpenFile:
   lda #GeosMenuFile
   bne GeosMouseOpenMenu
GeosMouseOpenEdit:
   lda #GeosMenuEdit
   bne GeosMouseOpenMenu
GeosMouseOpenView:
   lda #GeosMenuView
   bne GeosMouseOpenMenu
GeosMouseOpenDisk:
   lda #GeosMenuDisk
   bne GeosMouseOpenMenu
GeosMouseToggleSID:
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMouseCloseOverlay
+
   lda #ChrF4
   jmp MouseReturnVirtualKey
GeosMouseOpenMenu:
   jsr GeosShellToggleMenu
   jmp MouseNoTarget
GeosMouseDismissMenu:
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne +
   jmp GeosMouseCloseOverlay
+
   jmp MouseNoTarget

GeosMouseDropdown:
   ldx MouseFrameX
   ldy MouseFrameY
   jsr GeosShellMenuHitTest
   bcs +
   jmp GeosMouseCloseOverlay
+
   sta GeosMenuSelection
   jsr GeosShellMenuActivate
   jmp MouseNoTarget

; X=mouse logical half-pixel, Y=pixel row. C set and A=item inside the panel;
; C clear outside. Shared with the hardware-free preview (no activation here).
GeosShellMenuHitTest:
   stx GeosWorkCol
   cpy #10
   bcc GeosShellMenuMiss
   tya
   sec
   sbc #10
   ldx #0
GeosMenuHitRow:
   cmp #12
   bcc +
   sbc #12
   inx
   bne GeosMenuHitRow
+  stx GeosWorkItem
   txa
   ldx GeosActiveMenu
   cmp TblGeosMenuCount,x
   bcs GeosShellMenuMiss
   lda GeosWorkCol
   cmp RichDropdownHalfX,x
   bcc GeosShellMenuMiss
   sec
   sbc RichDropdownHalfX,x
   cmp RichDropdownHalfWidth,x
   bcs GeosShellMenuMiss
   lda GeosWorkItem
   sec
   rts
GeosShellMenuMiss:
   clc
   rts

RichDropdownHalfX: !byte 0,24,40,56,72
RichDropdownHalfWidth: !byte 60,64,64,56,68

GeosMouseControl:
   jsr GeosPanelControlHitTest
   bcs +
   jmp MouseNoTarget
+  cmp #$ff
   bne +
   jmp GeosMouseCloseOverlay
+
   sta MouseHitItem
   lda MouseOpenArmed
   beq GeosMouseSelectControl
   lda MouseLastClickedItem
   cmp MouseHitItem
   bne GeosMouseSelectControl
   lda GeosControlSelection
   cmp MouseHitItem
   bne GeosMouseSelectControl
   lda #0
   sta MouseOpenArmed
   lda #ChrReturn
   sec
   rts
GeosMouseSelectControl:
   lda #1
   sta MouseOpenArmed
   lda MouseHitItem
   sta MouseLastClickedItem
   jsr GeosPanelControlSetSelection
   clc
   rts

GeosMouseArrange:
   jsr GeosHomeHitTestXYSlot
   bcs +
   jmp MouseNoTarget
+
   jsr GeosArrangeTrySlot
   lda #ChrReturn
   sec
   rts

GeosMouseHome:
   jsr GeosHomeHitTestXYIcon
   bcs +
   jmp MouseNoTarget
+
   sta MouseHitItem
   sta GeosDragCandidate
   tax
   lda TblGeosHomeIconSlot,x
   sta GeosDragOrigin
   sta GeosDragTarget
   lda #0
   sta GeosDragActive
   lda MouseOpenArmed
   beq GeosMouseSelectHome
   lda MouseLastClickedItem
   cmp MouseHitItem
   bne GeosMouseSelectHome
   lda GeosHomeSelection
   cmp MouseHitItem
   bne GeosMouseSelectHome
   lda #0
   sta MouseOpenArmed
   lda #ChrReturn
   sec
   rts
GeosMouseSelectHome:
   lda MouseHitItem
   sta MouseLastClickedItem
   lda #1
   sta MouseOpenArmed
   lda #GeosNoticeNone
   sta GeosNotice
   lda MouseHitItem
   cmp GeosHomeSelection
   beq GeosMouseHomeSelected
   jsr GeosHomeSelect
GeosMouseHomeSelected:
   clc
   rts

GeosMouseCloseOverlay:
   lda GeosOverlayMode
   cmp #GeosOverlayMenu
   bne +
   jsr GeosShellCloseMenu
   jmp MouseNoTarget
+
   lda #GeosOverlayNone
   sta GeosOverlayMode
   sta GeosNotice
   jsr GeosShellRedraw
   jmp MouseNoTarget

; Drag/arrange snap cells follow the native 60x54 pixel icon pitch.
; Use the frame coordinates, not rounded character columns. C set/A=slot.
GeosHomeHitTestXYSlot:
   lda MouseFrameX
   cmp #150
   bcs GeosHomeHitFail
   ldx #0
-  cmp #30
   bcc +
   sec
   sbc #30
   inx
   bne -
+  stx GeosWorkCol
   lda MouseFrameY
   cmp #20
   bcc GeosHomeHitFail
   cmp #182
   bcs GeosHomeHitFail
   cmp #74
   bcc GeosHomeHitRow0
   cmp #128
   bcc GeosHomeHitRow1
   lda #10
   bne GeosHomeHitRowReady
GeosHomeHitRow1:
   lda #5
   bne GeosHomeHitRowReady
GeosHomeHitRow0:
   lda #0
GeosHomeHitRowReady:
   sta GeosWorkSlot
   lda GeosWorkCol
   clc
   adc GeosWorkSlot
   sec
   rts
GeosHomeHitFail:
   clc
   rts

GeosHomeHitTestXYIcon:
   ;The native artwork uses a 60x54 pixel pitch, not the old character grid.
   ;Only the icon and its actual label are clickable; gaps are not targets.
   jmp GeosRichHitHome

; Called every active mouse frame. Leaving the original cell starts a drag;
; the icon sprite then follows the mouse while an on-screen grid shows where
; the single persisted position will snap on release.
GeosShellMouseDragFrame:
   lda BrowserDragging
   beq GeosMouseHomeDragFrame
   lda MouseFrameDown
   bne +
   jmp GeosBrowserDragEnd
+  jsr GeosBrowserDragMove
   bcc +
   jmp GeosBrowserDrawScrollbar
+  rts
GeosMouseHomeDragFrame:
   lda MouseFrameDown
   beq GeosMouseDragRelease
   lda #1
   sta GeosMouseWasDown
   lda GeosDragCandidate
   cmp #$ff
   beq GeosMouseDragDone
   lda GeosViewMode
   beq GeosMouseDragDone
   lda GeosSurfaceMode
   bne GeosMouseDragDone
   lda GeosOverlayMode
   bne GeosMouseDragDone

   jsr GeosHomeHitTestXYSlot
   bcc GeosMouseDragNoTarget
   sta GeosWorkSlot
   cmp GeosDragTarget
   beq GeosMouseDragDone
   cmp GeosDragOrigin
   beq GeosMouseDragUseTarget
   jsr GeosHomeSlotIsEmpty
   bcc GeosMouseDragNoTarget
GeosMouseDragUseTarget:
   lda GeosWorkSlot
   sta GeosDragTarget
   lda GeosDragActive
   bne GeosMouseDragDone
   inc GeosDragActive
   jsr Mouse1351DragIconBegin
   jsr GeosShellRedraw
GeosMouseDragDone:
   rts
GeosMouseDragNoTarget:
   lda GeosDragActive
   bne +
   inc GeosDragActive
   jsr Mouse1351DragIconBegin
   jsr GeosShellRedraw
+
   lda #$ff
   sta GeosDragTarget
   rts

GeosMouseDragRelease:
   lda GeosMouseWasDown
   beq GeosMouseDragDone
   lda #0
   sta GeosMouseWasDown
   lda GeosDragCandidate
   cmp #$ff
   beq GeosMouseDragDone
   lda GeosDragActive
   beq GeosMouseReleaseWithoutDrag
   jsr Mouse1351DragIconEnd
   lda GeosDragTarget
   cmp #$ff
   beq GeosMouseReleaseClearCandidate
   cmp GeosDragOrigin
   beq GeosMouseReleaseClearCandidate
   ldx GeosDragCandidate
   sta TblGeosHomeIconSlot,x
   jsr GeosShellPersistIcon
   lda #GeosNoticeSaved
   sta GeosNotice
   ;A completed drag must not also count as the first half of a double-click.
   lda #0
   sta MouseOpenArmed
GeosMouseReleaseClearCandidate:
   lda #$ff
   sta GeosDragCandidate
   lda #0
   sta GeosDragActive
   jmp GeosShellRedraw
GeosMouseReleaseWithoutDrag:
   ;A normal click already redrew when it selected the icon.  Avoid a second,
   ;expensive bitmap conversion on button-up and preserve double-click timing.
   lda #$ff
   sta GeosDragCandidate
   lda #0
   sta GeosDragActive
   rts

; ---------------------------------------------------------------------------
; Layout, strings, and original monochrome home icon artwork

TblGeosHomeIconSlot:
   !byte 0,1,2,3,4,5,6,8,9

TblGeosSlotLeft:
   !byte 4,0,1,2,3, 9,5,6,7,8, 14,10,11,12,13
TblGeosSlotRight:
   !byte 1,2,3,4,0, 6,7,8,9,5, 11,12,13,14,10
TblGeosSlotUp:
   !byte 10,11,12,13,14, 0,1,2,3,4, 5,6,7,8,9
TblGeosSlotDown:
   !byte 5,6,7,8,9, 10,11,12,13,14, 0,1,2,3,4

TblGeosNotice:
   !word MsgNoticeNone,MsgNoticeAbout,MsgNoticeFirmware,MsgNoticeSaved,MsgNoticeFileScope

TblGeosMenuCount: !byte 7,6,3,4,5
TblGeosMenuListLo:
   !byte <TblDeskMenu,<TblFileMenu,<TblEditMenu,<TblViewMenu,<TblDiskMenu
TblGeosMenuListHi:
   !byte >TblDeskMenu,>TblFileMenu,>TblEditMenu,>TblViewMenu,>TblDiskMenu

TblDeskMenu: !word MsgMenuAbout,MsgMenuControl,MsgMenuRefresh,MsgMenuClassic
   !word MsgMenuSnake,MsgMenuCalculator,MsgMenuTextViewer
MsgMenuSnake: !tx "SNAKE",0
MsgMenuCalculator: !tx "CALCULATOR",0
MsgMenuTextViewer: !tx "TEXT VIEWER",0
TblFileMenu: !word MsgMenuOpen,MsgMenuDesktop,MsgMenuParent,MsgMenuFirmware,MsgMenuDelete
   !word MsgMenuBootDisk
TblEditMenu: !word MsgMenuCopy,MsgMenuPaste,MsgMenuArrange
TblViewMenu: !word MsgMenuDesktop,MsgMenuIcons,MsgMenuList,MsgMenuRefresh
TblDiskMenu: !word MsgShellMenuTeensy,MsgShellMenuSD,MsgMenuUSB,MsgMenuDrive8,MsgMenuDrive9

TblGeosControlPage:
   !byte 3,1,2,1,5,4,6,0

MsgNoticeNone:     !tx "READY",0
;No action sets the old About notice. Keep its table slot valid by reusing
;the current About menu label; the actual About window has its own version.
MsgNoticeAbout = MsgMenuAbout
MsgNoticeFirmware: !tx "SELECT A .HEX FILE TO UPDATE",0
MsgNoticeSaved:    !tx "DESKTOP POSITION SAVED",0
MsgNoticeFileScope:!tx "SELECT AN SD OR USB FILE",0

MsgMenuAbout:    !tx "ABOUT MPE FIRMWARE",0
MsgMenuControl:  !tx "CONTROL PANEL",0
MsgMenuRefresh:  !tx "REFRESH",0
MsgMenuClassic:  !tx "CLASSIC MENU",0
MsgMenuOpen:     !tx "OPEN",0
MsgMenuBootDisk: !tx "BOOT DISK",0
MsgBootNeedsDrive: !tx "BOOT DISK NEEDS DRIVE 8 OR 9",0
MsgMenuDesktop:  !tx "DESKTOP",0
MsgMenuParent:   !tx "PARENT FOLDER",0
MsgMenuFirmware: !tx "FIRMWARE UPDATE",0
MsgMenuCopy:     !tx "COPY     SHIFT+C",0
MsgMenuPaste:    !tx "PASTE    SHIFT+P",0
MsgMenuDelete:   !tx "DELETE... SHIFT+D",0
MsgMenuArrange:  !tx "ARRANGE ICONS",0
MsgMenuIcons:    !tx "ICONS",0
MsgMenuList:     !tx "LIST",0
MsgShellMenuTeensy: !tx "TEENSY MEMORY",0
MsgShellMenuSD:     !tx "SD CARD",0
MsgMenuUSB:      !tx "USB STORAGE",0
MsgMenuDrive8:   !tx "DRIVE 8",0
MsgMenuDrive9:   !tx "DRIVE 9",0

MsgControlAppearance:!tx "APPEARANCE",0
MsgControlInput:     !tx "INPUT",0
MsgControlStartup:   !tx "STARTUP",0
MsgControlStorage:   !tx "STORAGE",0
MsgControlClock:     !tx "CLOCK",0
MsgControlMidiNet:   !tx "MIDI/NET",0
MsgControlSystem:    !tx "SYSTEM",0
MsgControlAdvanced:  !tx "ADVANCED",0
MsgControlMusic:     !tx "MUSIC",0

GeosSurfaceMode:       !byte GeosSurfaceHome
GeosOverlayMode:       !byte GeosOverlayNone
GeosActiveMenu:        !byte 0
GeosMenuSelection:     !byte 0
GeosHomeSelection:     !byte 0
GeosAppearancePrefs:   !byte rpud3BackgroundDots
GeosControlSelection:  !byte 0
GeosControlMode:       !byte 0
GeosControlOld:        !byte 0
GeosMusicName:         !fill 39,0
GeosNotice:            !byte 0
GeosShellKey:          !byte 0
GeosWorkSlot:          !byte 0
GeosFolderIndex:       !byte 0
GeosArrangeOrigin:     !byte 0
GeosDragCandidate:     !byte $ff
GeosDragOrigin:        !byte 0
GeosDragTarget:        !byte 0
GeosDragActive:        !byte 0
GeosMouseWasDown:      !byte 0
GeosAppRequest:        !byte 0
