'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.join(__dirname, '..', 'source');
const repoRoot = path.resolve(__dirname, '../../../..');
const shell = fs.readFileSync(path.join(sourceDir, 'GeosShell.s'), 'utf8');
const main = fs.readFileSync(path.join(sourceDir, 'MainMenu.asm'), 'utf8');
const wrapper = fs.readFileSync(path.join(sourceDir, 'DesktopShell.asm'), 'utf8');
const payload = fs.readFileSync(path.join(sourceDir, 'DesktopShellCode.asm'), 'utf8');
const strings = fs.readFileSync(path.join(sourceDir, 'StringFunctions.s'), 'utf8');
const mouse = fs.readFileSync(path.join(sourceDir, 'Mouse1351.s'), 'utf8');
const preview = fs.readFileSync(path.join(sourceDir, 'DesktopPreview.asm'), 'utf8');
const desktop = fs.readFileSync(path.join(sourceDir, 'GeosDesktop.s'), 'utf8');
const bitmap = fs.readFileSync(path.join(sourceDir, 'GeosBitmap.s'), 'utf8');
const rich = fs.readFileSync(path.join(sourceDir, 'GeosRich.s'), 'utf8');
const browser = fs.readFileSync(path.join(sourceDir,'GeosBrowser.s'),'utf8');
const iec = fs.readFileSync(path.join(sourceDir, 'GeosIEC.s'), 'utf8');
const items = fs.readFileSync(path.join(repoRoot, 'Source/Teensy/MainMenuItems.h'), 'utf8');
const firmware = fs.readFileSync(path.join(repoRoot, 'Source/Teensy/TeensyROM.h'), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('native mouse targets exclude empty cell space and use rendered icon coordinates', () => {
  assert.match(shell, /GeosHomeHitTestXYIcon:[\s\S]*?jmp GeosRichHitHome/);
  assert.match(mouse, /MouseHitDesktop:\s*!ifdef DesktopShell \{\s+jsr GeosRichHitFile/);
  assert.match(iec, /GeosIECMouseClick:[\s\S]*?jsr GeosRichHitFile\s+bcc GeosIECMouseNoTarget/);
  const homeHit = sourceBlock(rich, 'GeosRichHitHome:', 'GeosRichHitFile:');
  for (const table of ['TblGeosHomeIconSlot', 'RichSlotX', 'RichSlotXHi', 'RichSlotY', 'RichLabelLo', 'RichLabelHi']) {
    assert.ok(homeHit.includes(table), `home target must follow ${table}`);
  }
  assert.match(homeHit, /adc #19/);
  assert.match(homeHit, /RichHitHomeLabel:\s+jsr RichHitCountLine/);
  assert.match(homeHit, /cmp #GeosHomeIconCount/);
  const fileHit = sourceBlock(rich, 'GeosRichHitFile:', 'RichHitItem:');
  assert.match(fileHit, /cmp #DesktopViewportItems/);
  assert.match(fileHit, /lda #24\s+sta RichW\s+lda #16\s+sta RichH/);
  assert.match(fileHit, /lda #11\s+sta RichHitLimit\s+lda #2\s+sta RichHitLines/);
  assert.match(fileHit, /lda RichLength\s+beq RichHitFileAdvance/);
});

test('mouse drag snap cells use the same 60x54 pitch as the native home artwork', () => {
  const snap = sourceBlock(shell, 'GeosHomeHitTestXYSlot:', 'GeosHomeHitTestXYIcon:');
  assert.match(snap, /lda MouseFrameX\s+cmp #150/);
  assert.match(snap, /sbc #30/);
  assert.match(snap, /lda MouseFrameY\s+cmp #20/);
  assert.match(snap, /cmp #74/);
  assert.match(snap, /cmp #128/);
});

test('vertical desktop navigation skips empty rows instead of losing shifted Up', () => {
  for (const direction of ['Up', 'Down']) {
    const block = sourceBlock(shell, `GeosHomeMove${direction}:`,
      direction === 'Up' ? 'GeosHomeMoveDown:' : 'GeosHomeMoveFound:');
    assert.match(block, /lda #3/);
    assert.match(block, /sta GeosWorkCount/);
    assert.match(block, /jsr GeosHomeSlotToIcon\s+bcs GeosHomeMoveFound\s+dec GeosWorkCount/);
    assert.match(block, new RegExp(`jmp GeosHome${direction}Loop`));
  }
});

test('the compact cartridge boots the flash-backed standalone desktop', () => {
  assert.match(payload, /!set DesktopShell=1/);
  assert.match(wrapper, /\* = \$0801[\s\S]*!binary "build\/DesktopShellCode\.bin"/);
  assert.match(main, /!ifndef DesktopShell[\s\S]*ldx #9[\s\S]*lda #3[\s\S]*jmp DirectRunFromTeensyMenu/);
  assert.match(main, /DirectRunFromTeensyMenu:[\s\S]*lda GeosViewMode\s+sta DirectRestoreView\+1\s+lda #0\s+sta GeosViewMode\s+jsr GeosSyncMenuView[\s\S]*jsr SelectItem[\s\S]*jsr SelectItem[\s\S]*DirectRestoreView:/);
  assert.match(items, /\/\*3\*\/rtFilePrg[\s\S]*"TeensyROM Desktop Shell"[\s\S]*DesktopShell_prg/);
  assert.match(firmware, /#include "TRMenuFiles\/ROMs\/DesktopShell\.prg\.h"/);
});

test('desktop exposes five menus, drives and control panel with deletion in the File menu', () => {
  assert.match(rich, /RichMenuNameLo: !byte <RichTeensyName,<RichFileName,<RichEditName,<RichViewName,<RichDiskName/);
  assert.match(shell, /TblGeosMenuCount:\s*!byte 7,6,3,4,5/);
  assert.match(shell, /GeosMouseOpenDesk:\s+lda #GeosMenuDesk\s+jmp GeosMouseOpenMenu/);
  assert.match(rich, /RichDrive8:[^\n]*"DRIVE 8"/);
  assert.match(rich, /RichDrive9:[^\n]*"DRIVE 9"/);
  assert.match(rich, /RichGames:[^\n]*"GAMES"/);
  assert.match(rich, /RichUtilities:[^\n]*"UTILITIES"/);
  assert.match(rich, /RichControl:[^\n]*"CONTROL",13,"PANEL"/);
  assert.doesNotMatch(shell, /MsgHomeTrash:|GeosHomeOpenTrash:/);
  assert.match(shell, /GeosHomeIconCount = 8/);
  assert.match(shell, /GeosActivateFileMenu:[\s\S]*?cmp #4\s+bne \+\s+jmp GeosFileDelete/);
  assert.match(strings, /DisplayTime:\s*!ifdef DesktopShell \{\s+lda GeosBitmapActive\s+beq \+\s+jmp GeosBitmapDisplayTime/);
});

test('desktop redraw hides only the pointer while true exits clear click state', () => {
  const redrawHide = sourceBlock(mouse, 'Mouse1351HideForRedraw:', 'Mouse1351Hide:');
  assert.match(redrawHide, /lda SpriteEnable\s+and #%11111110\s+sta SpriteEnable\s+rts/);
  assert.doesNotMatch(redrawHide, /MouseMenuEnabled|MouseClickEdge|MouseOpenArmed/);

  const fullHide = sourceBlock(mouse, 'Mouse1351Hide:', '; Called once around');
  assert.match(fullHide, /jsr Mouse1351HideForRedraw/);
  assert.match(
    fullHide,
    /lda #0\s+sta MouseMenuEnabled\s+sta MouseClickEdge\s+sta MouseOpenArmed/,
  );

  const textMode = sourceBlock(main, 'TextScreenMemColor:', 'ScreenColorOnly:');
  assert.match(textMode, /jsr Mouse1351HideForRedraw/);
  assert.doesNotMatch(textMode, /jsr Mouse1351Hide\s/);
  assert.match(main, /RunSelected:\s+jsr Mouse1351Hide\s/);
});

test('switching to the classic recovery list restores the full keyboard matrix', () => {
  const classic = sourceBlock(mouse, 'Mouse1351ProcessMenu:', 'MouseProcessCheckActive:');
  assert.match(classic, /lda GeosViewMode\s+bne MouseProcessCheckActive\s+jsr Mouse1351Hide\s+jmp Mouse1351RestoreKeyboard/);

  const restore = sourceBlock(mouse, 'Mouse1351RestoreKeyboard:', '; Called once around');
  assert.match(restore, /php\s+sei\s+lda #0\s+sta CIA1_DDRB\s+lda #\$ff\s+sta CIA1_DDRA\s+sta CIA1_RegA\s+plp\s+clc\s+rts/);

  const sampler = sourceBlock(mouse, 'Mouse1351IRQSample:', 'Mouse1351SampleState:');
  assert.match(sampler, /lda GeosViewMode\s+beq Mouse1351IRQClassic\s+jsr Mouse1351SampleState/);
  assert.match(sampler, /Mouse1351IRQClassic:\s+jmp Mouse1351RestoreKeyboard/);
  const setView = sourceBlock(shell, 'GeosSetViewMode:', 'GeosActivateDiskMenu:');
  assert.match(setView, /sta GeosViewMode[\s\S]*?bne \+[\s\S]*?jsr Mouse1351RestoreKeyboard[\s\S]*?\+\s+lda GeosViewMode/);
});

test('mouse pointer remains visible on the light desktop surface', () => {
  assert.match(
    mouse,
    /Mouse1351ShowPointer:[\s\S]*?lda #PokeBlack\s+sta Sprite0Color/,
  );
});

test('expanded browser uses shared proportional scrollbar and row viewport', () => {
  assert.doesNotMatch(shell,/GeosMouseBrowserPage:|MsgGeosPage:/);
  assert.match(rich,/UiBrowserScroll: !byte 46,1,36,12,0,164/);
  assert.match(browser,/GeosBrowserGeometry:[\s\S]*BrowserScale/);
  assert.match(shell,/jsr GeosBrowserDragStart/);
});

test('clock-adjacent media control uses the established F4 SID toggle', () => {
  const menuHit = sourceBlock(shell, 'GeosMouseMenuBar:', 'GeosMouseDropdown:');
  assert.match(
    menuHit,
    /cpx #22\s+bcc GeosMouseOpenDisk\s+cpx #28\s+bcc GeosMouseDismissMenu\s+cpx #30\s+bcc GeosMouseToggleSID/,
  );
  assert.match(
    menuHit,
    /GeosMouseToggleSID:\s+lda GeosOverlayMode\s+cmp #GeosOverlayMenu\s+bne \+\s+jmp GeosMouseCloseOverlay\s+\+\s+lda #ChrF4\s+jmp MouseReturnVirtualKey/,
  );
  assert.match(main, /cmp #ChrF4[\s\S]*jsr ToggleSIDMusic/);
});

test('clicking the same open header closes it while another header switches menus', () => {
  const toggle = sourceBlock(shell, 'GeosShellToggleMenu:', 'GeosShellOpenControl:');
  assert.match(toggle, /tax\s+lda GeosOverlayMode\s+cmp #GeosOverlayMenu\s+bne GeosShellToggleMenuOpen\s+cpx GeosActiveMenu\s+bne GeosShellToggleMenuOpen\s+jmp GeosMouseCloseOverlay/);
  assert.match(toggle, /GeosShellToggleMenuOpen:\s+txa\s+jmp GeosShellOpenMenu/);
  assert.match(shell, /GeosMouseOpenMenu:\s+jsr GeosShellToggleMenu\s+jmp MouseNoTarget/);
});

test('clicking outside a menu dismisses it without activating the underlying surface', () => {
  const bar = sourceBlock(shell, 'GeosMouseMenuBar:', 'GeosMouseOpenDesk:');
  assert.match(bar, /cpx #6\s+bcc GeosMouseOpenDesk\s+cpx #10\s+bcc GeosMouseOpenFile\s+cpx #14\s+bcc GeosMouseOpenEdit\s+cpx #18\s+bcc GeosMouseOpenView\s+cpx #22\s+bcc GeosMouseOpenDisk/);
  assert.match(bar, /cpx #28\s+bcc GeosMouseDismissMenu/);
  assert.match(bar, /cpx #30\s+bcc GeosMouseToggleSID\s+jmp GeosMouseDismissMenu/);
  assert.match(shell, /GeosMouseDismissMenu:\s+lda GeosOverlayMode\s+cmp #GeosOverlayMenu\s+bne \+\s+jmp GeosMouseCloseOverlay\s+\+\s+jmp MouseNoTarget/);
  assert.match(shell, /GeosMouseDropdown:\s+ldx MouseFrameX\s+ldy MouseFrameY\s+jsr GeosShellMenuHitTest\s+bcs \+\s+jmp GeosMouseCloseOverlay/);
  assert.match(shell, /GeosMouseCloseOverlay:\s+lda GeosOverlayMode\s+cmp #GeosOverlayMenu\s+bne \+\s+jsr GeosShellCloseMenu\s+jmp MouseNoTarget/);
  assert.match(shell, /GeosShellCloseMenu:\s+lda #GeosOverlayNone\s+sta GeosOverlayMode\s+sta GeosNotice\s+jmp GeosMenuRedraw/);
  assert.match(mouse, /MouseNoTarget:\s+lda #0\s+sta MouseOpenArmed\s+clc\s+rts/);
});

test('dropdown bounds exclude the right edge and the row below the last item', () => {
  const hit = sourceBlock(shell, 'GeosShellMenuHitTest:', 'GeosMouseControl:');
  assert.match(hit, /stx GeosWorkCol\s+cpy #10\s+bcc GeosShellMenuMiss/);
  assert.match(hit, /sbc #10\s+ldx #0\s+GeosMenuHitRow:\s+cmp #12\s+bcc \+\s+sbc #12\s+inx\s+bne GeosMenuHitRow\s+\+\s+stx GeosWorkItem\s+txa\s+ldx GeosActiveMenu\s+cmp TblGeosMenuCount,x\s+bcs GeosShellMenuMiss/);
  assert.match(hit, /cmp RichDropdownHalfX,x\s+bcc GeosShellMenuMiss\s+sec\s+sbc RichDropdownHalfX,x\s+cmp RichDropdownHalfWidth,x\s+bcs GeosShellMenuMiss/);
  assert.match(hit, /RichDropdownHalfX:\s*!byte 0,24,40,56,72/);
  assert.match(hit, /RichDropdownHalfWidth:\s*!byte 60,64,64,56,68/);
  assert.match(hit, /lda GeosWorkItem\s+sec\s+rts\s+GeosShellMenuMiss:\s+clc\s+rts/);
  assert.doesNotMatch(hit, /GeosShellMenuActivate|MouseFrameX/);
});

test('VICE preview shares menu toggles and outside dismissal without invoking hardware actions', () => {
  const click = sourceBlock(preview, 'PreviewMouseClick:', '; Snapshots after first home');
  assert.match(click, /cpx #22\s+bcs PreviewMouseDismissMenu\s+jmp GeosMouseMenuBar/);
  assert.match(click, /PreviewMouseDismissMenu:\s+jmp GeosMouseDismissMenu/);
  assert.match(click, /cmp #GeosOverlayMenu\s+bne PreviewMouseDone\s+ldx MouseFrameX\s+ldy MouseFrameY\s+jsr GeosShellMenuHitTest\s+bcc \+\s+sta GeosMenuSelection\s+jsr PreviewActivateApp/);
  assert.match(click, /PreviewActivateApp:\s+lda GeosOverlayMode\s+cmp #GeosOverlayMenu\s+bne PreviewMouseDone\s+lda GeosActiveMenu\s+bne PreviewMouseDone\s+lda GeosMenuSelection\s+cmp #4\s+bcc PreviewMouseDone\s+jmp GeosShellMenuActivate/);
  assert.doesNotMatch(click, /GeosMouseToggleSID|GeosShellOpenMenu|GeosShellOpenSource/);
});

test('legacy KERNAL pages leave bitmap mode before printing a banner', () => {
  const banner = sourceBlock(strings, 'PrintBanner:', 'DisplayTime:');
  assert.match(
    banner,
    /sta GeosBitmapLayoutPass[\s\S]*?jsr TextScreenMemColor\s+jsr Mouse1351Hide[\s\S]*?jsr PrintString/,
  );
});

test('legacy WAIT messages also leave bitmap mode before KERNAL output', () => {
  assert.match(
    main,
    /WaitForTRDots:[\s\S]*?jsr GeosBitmapPrepareLegacyWait[\s\S]*?WaitForTRWaitMsg:[\s\S]*?jsr GeosBitmapPrepareLegacyWait/,
  );
});

test('home shares the bitmap shortcut footer while arrange mode retains instructions', () => {
  const home = sourceBlock(rich, 'GeosRichHome:', 'RichHomeIcon:');
  assert.match(home, /cmp #GeosOverlayArrange\s+beq \+\s+jmp GeosRichBrowserFooter/);
  assert.match(home, /lda #192\s+sta RichY[\s\S]*lda #<RichArrangeText/);
  assert.doesNotMatch(home, /TblGeosHomeStatus|RichIconsText/);
  assert.doesNotMatch(home, /GeosBlankLine|SetCursor|SendChar/);
  assert.doesNotMatch(shell, /GeosShellDrawHomeStatus:|GeosShellDrawLegacyHome:/);
});

test('home desktop uses native icon assets without emitting obsolete character icons', () => {
  const home = sourceBlock(rich, 'GeosRichHome:', 'RichHomeIcon:');
  const icon = sourceBlock(rich, 'RichHomeIcon:', 'GeosRichFileNames:');
  assert.match(home, /RichHomeIconLoop:\s+jsr RichHomeIcon/);
  assert.match(icon, /lda RichIconLo,x\s+sta RichSource\+1\s+lda RichIconHi,x\s+sta RichSource\+2/);
  assert.match(icon, /jsr RichBlit/);
  assert.doesNotMatch(shell, /GeosHomeIconData:|GeosDrawHomeIcon:/);
});

test('control categories route to Settings pages and moved icons persist one snapped slot', () => {
  assert.match(shell, /TblGeosControlPage:\s*!byte 3,1,2,1,5,4,6,0/);
  assert.match(shell, /GeosShellLaunchControlPage:[\s\S]*ora #\$80[\s\S]*sta rwRegScratch\+IO1Port/);
  assert.match(shell, /GeosHomeSlotCount = 15/);
  assert.match(shell, /GeosHomeSlotIsEmpty:[\s\S]*GeosHomeSlotToIcon/);
  assert.match(shell, /GeosShellPersistIcon:[\s\S]*sta rwRegDesktopSlotStart\+IO1Port,x[\s\S]*jsr WaitForTRWaitMsg/);
  assert.match(shell, /lda GeosDragActive\s+beq GeosMouseReleaseWithoutDrag[\s\S]*sta MouseOpenArmed\s+GeosMouseReleaseClearCandidate:/);
  const noDragRelease = sourceBlock(
    shell,
    'GeosMouseReleaseWithoutDrag:',
    '; ---------------------------------------------------------------------------',
  );
  assert.doesNotMatch(noDragRelease, /GeosShellRedraw/);
});

test('Firmware Update opens removable-media browsing without bypassing RunSelected', () => {
  const actionStart = shell.indexOf('GeosActivateFileMenu:');
  const actionEnd = shell.indexOf('GeosFileOpen:', actionStart);
  const firmwareAction = shell.slice(actionStart, actionEnd);

  assert.match(firmwareAction, /lda #rmtSD[\s\S]*jsr GeosShellOpenSource[\s\S]*lda #GeosNoticeFirmware/);
  assert.doesNotMatch(firmwareAction, /DoFlashUpdate|StartSelItem_WaitForTRDots|rCtlStartSelItemWAIT/);
  assert.match(shell, /MsgNoticeFirmware:[^\n]*"SELECT A \.HEX FILE TO UPDATE"/);
});

test('folder views use shared pixel bounds for close, parent and scrollbar', () => {
  const controls=sourceBlock(shell,'GeosShellMouseClick:','GeosMouseFunctionBar:');
  assert.match(controls,/jsr UiWindowCloseHit[\s\S]*jsr GeosFileDesktop/);
  assert.match(controls,/lda #<UiBrowserParent[\s\S]*jsr UiHit[\s\S]*jsr GeosFileParent/);
  assert.match(controls,/lda #<UiBrowserScroll[\s\S]*jsr UiHit/);
  assert.match(shell,/cmp #ChrHome[\s\S]*?jsr GeosFileDesktop/);
  const back=sourceBlock(shell,'GeosShellBackOrMenu:','GeosShellKeyControl:');
  assert.match(back,/lda GeosSurfaceMode[\s\S]*jsr GeosFileDesktop/);
});

test('browser gives the fifth icon row the former footer space while home retains one F-key strip', () => {
  const footer = sourceBlock(shell, 'GeosShellDrawBrowserFooter:', 'GeosShellDrawOverlay:');
  assert.doesNotMatch(footer, /MsgGeosShellFooter[123]|MouseHitSourceBar|MouseHitActionBar/);
  assert.doesNotMatch(footer, /ldx #24\s+jsr GeosBlankLine/);
  assert.doesNotMatch(shell, /ldx #24\s+jsr GeosBlankLine/);
  assert.match(rich, /RichComposeFiles:\s+lda #0\s+tax\s+jsr RichClearCanvas\s+jsr GeosRichBrowserChrome\s+jsr GeosRichFileNames\s+RichComposeChrome:/);
  const nativeFooter = sourceBlock(rich, 'GeosRichBrowserFooter:', '; Browser chrome');
  assert.match(nativeFooter, /lda #192\s+sta RichY/);
  assert.match(nativeFooter, /RichFunctionHitLeft:\s*!byte 2,26,53,71,92,113,140/);
  assert.match(nativeFooter, /RichFunctionHitRight:\s*!byte 23,50,68,89,110,137,158/);
  assert.match(nativeFooter, /RichF1: !text "F1 HELP"/);
  assert.match(nativeFooter, /RichF7: !text "F7 MEM"/);
  assert.match(nativeFooter, /RichFunctionKey:\s*!byte ChrF1,ChrF2,ChrF3,ChrF5,ChrF7,ChrF8,\$56/);
  assert.doesNotMatch(nativeFooter, /HOME|PARENT|DESKTOP|\[OPEN\]|PAGE|ITEM/);
  for (const key of [1, 2, 3, 5, 7, 8]) {
    assert.equal((nativeFooter.match(new RegExp(`RichF${key}:`, 'g')) || []).length, 1);
  }
});

test('home footer has bounded pixel targets and browser fifth-row clicks bypass it', () => {
  const hit=sourceBlock(shell,'GeosMouseFunctionBar:','GeosMouseMenuBar:');
  assert.match(hit,/cmp RichFunctionHitLeft,x\s+bcc \+\s+cmp RichFunctionHitRight,x\s+bcs \+/);
  assert.match(hit,/cpx #RichFunctionCount\s+bne -\s+jmp MouseNoTarget/);
  const browserHit=sourceBlock(shell,'GeosShellMouseClick:','GeosMouseFunctionBar:');
  assert.match(browserHit,/cmp #189\s+bcc \+\s+lda GeosSurfaceMode\s+bne \+\s+jmp GeosMouseFunctionBar/);
  assert.match(browserHit,/cmp #36[\s\S]*cmp #196/);
  assert.doesNotMatch(browserHit,/MouseHitSourceBar|MouseHitActionBar|GeosMouseBrowserPage/);
});

test('browser status preserves selection without painting over the fifth icon row', () => {
  const liveStatus = sourceBlock(bitmap, 'GeosBitmapDrawBrowserStatus:', 'GeosBitmapLegacyMetadata:');
  assert.match(liveStatus, /GeosBitmapDrawBrowserStatus:\s+jmp GeosBitmapRefreshBrowserSelection/);
  assert.doesNotMatch(liveStatus, /GeosBitmapBlankLine|rsstItemName|MsgGeosSelected/);
  assert.doesNotMatch(liveStatus, /MsgGeosType|MsgGeosItem|MsgGeosPageStatus|ldx #20/);
  assert.doesNotMatch(bitmap, /(?:jsr|jmp) GeosBitmapLegacyMetadata/);
  const textStatus = sourceBlock(desktop, 'GeosDrawStatus:', 'GeosStatusDone:');
  assert.match(textStatus, /!ifdef DesktopShell \{\s+lda rwRegCursorItemOnPg\+IO1Port\s+cmp rRegNumItemsOnPage\+IO1Port\s+bcs GeosStatusDone\s+sta rwRegSelItemOnPage\+IO1Port\s+\}\s+!ifndef DesktopShell/);
  const iecStatus = sourceBlock(iec, 'GeosIECDrawStatus:', 'GeosIECGetEntry:');
  assert.match(iecStatus, /jsr GeosBitmapConvertScreen[\s\S]*jmp GeosBitmapShowMessage/);
  assert.doesNotMatch(iecStatus, /SetCursor|PrintString|ldx #19/);
  assert.match(iecStatus, /MsgIECError/);
  assert.match(iecStatus, /MsgIECEmpty/);
  assert.doesNotMatch(iecStatus, /MsgIECHelp|MsgIECPage|MsgGeosPageStatus|ldx #20|GeosIECPrintName/);
});

test('drive icons no longer silently alias SD or USB directories', () => {
  const drives = sourceBlock(shell, 'GeosHomeOpenDrive8:', 'GeosHomeOpenGames:');
  assert.doesNotMatch(drives, /rmtSD|rmtUSBDrive|GeosShellOpenSource/);
  assert.match(drives, /lda #8\s+jmp GeosIECOpenDrive/);
  assert.match(drives, /lda #9\s+jmp GeosIECOpenDrive/);
});

test('directory waits keep the bitmap visible while legacy confirmations retain text', () => {
  const wait = sourceBlock(main, 'WaitForTRDots:', 'WaitForTRMain   ;');
  assert.equal((wait.match(/jmp GeosBitmapWait/g) || []).length, 2);
  assert.match(wait, /lda GeosBitmapActive\s+beq \+\s+jmp GeosBitmapWait/);
});


test('assembled home and browser share seven footer labels and matching mouse targets', t =>
  require('./desktop-machine').desktopMachine(t, ({s, fresh, region}) => {
    const cpu=fresh(), labels=[];
    cpu.hooks.set(s.RichText, c => labels.push({
      x:c.m[s.RichX]+256*c.m[s.RichXHi], y:c.m[s.RichY], text:''
    }));
    cpu.hooks.set(s.RichChar,c=>{ if(c.m[s.RichY]===192) labels.at(-1).text+=String.fromCharCode(c.a); });
    cpu.m[s.GeosSurfaceMode]=s.GeosSurfaceHome;
    cpu.call(s.GeosRichHome);
    cpu.call(s.GeosRichPublish);
    const expected=[
      {x:4,y:192,text:'F1 HELP'}, {x:52,y:192,text:'F2 BASIC'},
      {x:106,y:192,text:'F3 SD'}, {x:142,y:192,text:'F5 USB'},
      {x:184,y:192,text:'F7 MEM'}, {x:226,y:192,text:'F8 PANEL'},
      {x:280,y:192,text:'V TEXT'}
    ];
    assert.deepEqual(labels.filter(label=>label.y===192),expected);
    assert.ok(region(cpu,280,192,36,8).some(Boolean),'V text draws beyond pixel255');
    const homeFooter=region(cpu,0,188,320,12);
    labels.length=0;
    cpu.call(s.GeosRichBrowserFooter);
    cpu.call(s.GeosRichPublish);
    assert.deepEqual(labels,expected);
    assert.deepEqual(region(cpu,0,188,320,12),homeFooter,'identical visible strip');
    const keys=[s.ChrF1,s.ChrF2,s.ChrF3,s.ChrF5,s.ChrF7,s.ChrF8,0x56];
    cpu.m[s.GeosSurfaceMode]=s.GeosSurfaceHome;
    for(let x=0;x<160;x++) {
      const i=labels.findIndex(label=>x>=label.x/2 && x<(label.x+label.text.length*6)/2);
      cpu.m[s.MouseFrameX]=x; cpu.m[s.MouseFrameY]=195;
      cpu.x=x>>2; cpu.y=195>>3;
      cpu.call(s.GeosShellMouseClick);
      assert.equal(cpu.a,i<0?0:keys[i], `home half-pixel ${x}`);
    }
    for(const surface of [s.GeosSurfaceBrowser,s.GeosSurfaceIEC]) {
      cpu.m[s.GeosSurfaceMode]=surface;
      cpu.m[s.IO1Port+s.rRegNumItemsOnPage]=0;
      cpu.m[s.GeosIECCount]=0;
      cpu.m[s.MouseFrameX]=4; cpu.m[s.MouseFrameY]=195;
      cpu.x=1; cpu.y=24;
      cpu.call(s.GeosShellMouseClick);
      assert.equal(cpu.p&1,0,`surface ${surface} has no invisible footer target`);
    }
    labels.length=0;
    cpu.m[s.GeosOverlayMode]=s.GeosOverlayArrange;
    cpu.call(s.RichHomeFooter);
    assert.deepEqual(labels,[{x:4,y:192,text:'MOVE ICON: ARROWS   RETURN: SAVE'}]);
  },{apps:false}));

test('home selection updates only its two labels and leaves the shortcut footer untouched', t =>
  require('./desktop-machine').desktopMachine(t, ({s,fresh})=> {
    const cpu=fresh();
    cpu.m[s.GeosSurfaceMode]=s.GeosSurfaceHome;
    cpu.call(s.GeosRichHome);
    cpu.call(s.GeosRichPublish);
    const footer=Buffer.from(cpu.m.subarray(s.GeosBitmapRAM+23*320,s.GeosBitmapRAM+8000));
    const writes=[];
    cpu.onWrite=(address)=>{ if(address>=s.GeosBitmapRAM && address<s.GeosBitmapRAM+8000) writes.push(address); };
    cpu.hooks.set(s.RichHomeFooter,()=>assert.fail('unchanged footer must not redraw under the selection mask'));
    cpu.hooks.set(s.RichClearFooter,()=>assert.fail('unchanged footer must not be erased'));
    cpu.p&=~4;
    cpu.a=1;
    cpu.call(s.GeosHomeSelect);
    assert.equal(cpu.m[s.GeosHomeSelection],1);
    assert.equal(cpu.p&4,0,'prior enabled IRQ state restored');
    assert.ok(writes.length>0,'actual visible label publication ran');
    assert.ok(writes.every(address=>address<s.GeosBitmapRAM+23*320),'no footer publication');
    assert.deepEqual(cpu.m.subarray(s.GeosBitmapRAM+23*320,s.GeosBitmapRAM+8000),footer);
  }));
