'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.join(__dirname, '..', 'source');
const desktop = fs.readFileSync(path.join(sourceDir, 'GeosDesktop.s'), 'utf8');
const bitmap = fs.readFileSync(path.join(sourceDir, 'GeosBitmap.s'), 'utf8');
const rich = fs.readFileSync(path.join(sourceDir, 'GeosRich.s'), 'utf8');
const richAssets = fs.readFileSync(path.join(sourceDir, 'GeosRichAssets.s'), 'utf8');
const sid = fs.readFileSync(path.join(sourceDir, 'SIDRelated.s'), 'utf8');
const common = fs.readFileSync(path.join(sourceDir, 'CommonDefs.i'), 'utf8');
const main = fs.readFileSync(path.join(sourceDir, 'MainMenu.asm'), 'utf8');
const mouse = fs.readFileSync(path.join(sourceDir, 'Mouse1351.s'), 'utf8');
const strings = fs.readFileSync(path.join(sourceDir, 'StringFunctions.s'), 'utf8');
const parser = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'Teensy', 'FileParsers.ino'),
    'utf8',
);
const stripComments = (source) => source.replace(/;[^\r\n]*/g, '');
const bitmapCode = stripComments(bitmap);
const desktopCode = stripComments(desktop);
const mainCode = stripComments(main);
const stringsCode = stripComments(strings);
const richCode = stripComments(rich);
const sidCode = stripComments(sid);

function sourceBlock(source, startLabel, endLabel) {
    const start = source.indexOf(startLabel);
    const end = source.indexOf(endLabel, start + startLabel.length);
    assert.notEqual(start, -1, `${startLabel} exists`);
    assert.notEqual(end, -1, `${endLabel} exists after ${startLabel}`);
    return source.slice(start, end);
}

function immediateStoredIn(source, target) {
    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(
        new RegExp(`lda\\s+#\\$([0-9a-f]{2})\\s+sta\\s+${escapedTarget}`, 'i'),
    );
    assert.ok(match, `an immediate byte is stored in ${target}`);
    return Number.parseInt(match[1], 16);
}

function tableAddresses(source, startLabel, endLabel, prefix) {
    const block = sourceBlock(source, startLabel, endLabel);
    const pattern = new RegExp(`${prefix}\\$([0-9a-f]{4})`, 'gi');
    return [...block.matchAll(pattern)].map((match) => Number.parseInt(match[1], 16));
}

test('monochrome desktop carries four complete 24x16 pixel icons', () => {
    const iconBlock = desktop.slice(
        desktop.indexOf('GeosIconData:'),
        desktop.indexOf('GeosIconDataEnd:'),
    );
    const bytes = [...iconBlock.matchAll(/%([01]{8})/g)].map((match) =>
        Number.parseInt(match[1], 2),
    );

    assert.equal(bytes.length, 4 * 6 * 8);
    for (let icon = 0; icon < 4; icon += 1) {
        const iconBytes = bytes.slice(icon * 48, icon * 48 + 48);
        assert.ok(iconBytes.some((value) => value !== 0), `icon ${icon} has pixels`);
    }
    assert.match(desktop, /GeosIconProgram = GeosIconDocument\+6/);
});

test('expanded shell presents a true 320x200 standard high-resolution bitmap', () => {
    assert.match(bitmapCode, /GeosBitmapRAM\s*=\s*\$2000/);
    assert.match(bitmapCode, /GeosBitmapRAMEnd\s*=\s*\$3f40/);
    assert.match(bitmapCode, /GeosBitmapScreen\s*=\s*C64ScreenRAM/);

    const conversion = sourceBlock(
        bitmapCode,
        'GeosBitmapConvertScreen:',
        'GeosBitmapCaptureFont:',
    );
    assert.match(conversion, /jsr GeosRichCompose/);
    const memorySetup = immediateStoredIn(conversion, 'VICMemSetup');
    const control2 = immediateStoredIn(conversion, '$d016');
    const control1 = immediateStoredIn(conversion, '$d011');
    assert.equal(memorySetup, 0x18); // screen $0400, bitmap $2000
    assert.equal(control2 & 0x10, 0); // MCM off: one bit per 320-wide pixel
    assert.equal(control2 & 0x08, 0x08); // 40 columns
    assert.equal(control1 & 0x20, 0x20); // BMM on
    assert.equal(control1 & 0x40, 0); // ECM off

    const expectedBitmapRows = Array.from({ length: 25 }, (_, row) =>
        0x2000 + row * 0x140,
    );
    const expectedScreenRows = Array.from({ length: 25 }, (_, row) =>
        0x0400 + row * 40,
    );
    assert.deepEqual(
        tableAddresses(bitmapCode, 'TblGeosBitmapRowLo:', 'TblGeosBitmapRowHi:', '<'),
        expectedBitmapRows,
    );
    assert.deepEqual(
        tableAddresses(
            bitmapCode,
            'TblGeosBitmapRowHi:',
            'TblGeosBitmapScreenRowLo:',
            '>',
        ),
        expectedBitmapRows,
    );
    assert.deepEqual(
        tableAddresses(
            bitmapCode,
            'TblGeosBitmapScreenRowLo:',
            'TblGeosBitmapScreenRowHi:',
            '<',
        ),
        expectedScreenRows,
    );
    assert.deepEqual(
        tableAddresses(
            bitmapCode,
            'TblGeosBitmapScreenRowHi:',
            'GeosBitmapActive:',
            '>',
        ),
        expectedScreenRows,
    );
});

test('each 8x8 bitmap cell receives one foreground/background screen byte', () => {
    const expectedColors = {
        Normal: 0x01,
        Accent: 0x61,
        Selected: 0x16,
        Clock: 0x76,
        Status: 0x0f,
    };
    for (const [name, expected] of Object.entries(expectedColors)) {
        const match = bitmapCode.match(
            new RegExp(`GeosBitmapColor${name}\\s*=\\s*\\$([0-9a-f]{2})`, 'i'),
        );
        assert.ok(match, `${name} color pair exists`);
        const colorByte = Number.parseInt(match[1], 16);
        assert.equal(colorByte, expected);
        assert.notEqual(colorByte >> 4, colorByte & 0x0f);
    }
    assert.match(
        bitmapCode,
        /GeosBitmapPublishColors:[\s\S]*sta C64ScreenRAM[\s\S]*cpx #232/,
    );
    assert.doesNotMatch(bitmapCode, /\$d800|C64ColorRAM/);
});

test('bitmap address math retains column times eight carry for columns 32 through 39', () => {
    const pointer = sourceBlock(
        bitmapCode,
        'GeosBitmapSetCellPointer:',
        'GeosBitmapTintSurface:',
    );
    assert.match(
        pointer,
        /sta GeosBitmapCellOffsetHi[\s\S]*asl\s+rol GeosBitmapCellOffsetHi[\s\S]*asl\s+rol GeosBitmapCellOffsetHi[\s\S]*asl\s+rol GeosBitmapCellOffsetHi/,
    );
    assert.match(
        pointer,
        /adc Ptr2AddrLo\s+sta Ptr2AddrLo\s+lda GeosBitmapCellOffsetHi\s+adc Ptr2AddrHi\s+sta Ptr2AddrHi/,
    );
});

test('native drawing uses absolute operands instead of borrowing SID zero page', () => {
    const primitives=sourceBlock(richCode,'RichAddress:','GeosRichHome:');
    assert.doesNotMatch(primitives,/PtrAddrLo|PtrAddrHi|Ptr2AddrLo|Ptr2AddrHi|\bsei\b/);
    assert.match(primitives,/RichSource:\s+lda \$ffff/);
    const widgets=stripComments(fs.readFileSync(path.join(sourceDir,'GeosWidgets.s'),'utf8'));
    assert.doesNotMatch(widgets,/PtrAddrLo|PtrAddrHi|Ptr2AddrLo|Ptr2AddrHi|\bsei\b/);
});

test('bitmap live text reaches the printable glyph path', () => {
    const putChar = sourceBlock(
        bitmapCode,
        'GeosBitmapPutChar:',
        'GeosBitmapPetsciiToScreen:',
    );
    assert.match(
        putChar,
        /cmp #ChrReturn\s+bne GeosBitmapPutPrintable[\s\S]*GeosBitmapPutPrintable:\s+jsr GeosBitmapPetsciiToScreen/,
    );
});

test('bitmap clock bar carries a dynamic SID play-pause icon', () => {
    // The live clock blits native assets directly; no legacy character cache.
    const mediaData = sourceBlock(richCode, 'RichPlay:', 'RichSavedBank:');
    const mediaBytes = [...mediaData.matchAll(/(?:\$([0-9a-f]{2})|(?<![\w$])([0-9]+))(?![\w])/gi)]
        .map((match) => match[1] ? parseInt(match[1], 16) : Number(match[2]));
    assert.equal(mediaBytes.length, 16);
    assert.notDeepEqual(mediaBytes.slice(0, 8), mediaBytes.slice(8, 16));
    assert.doesNotMatch(desktopCode, /GeosCopyMediaGlyphs:|GeosMediaIconData:/);
    assert.match(desktopCode, /GeosInstallMonoCharset:\s*!ifdef DesktopShell \{ rts \}\s*!ifndef DesktopShell \{/);

    const control = sourceBlock(richCode, 'RichClockPaintSnapshot:', 'RichClockSnapshot:');
    assert.match(control, /lda #232\s+sta RichX/);
    assert.match(control, /lda #<RichPause\s+ldy #>RichPause\s+ldx RichClockSID\s+beq \+\s+lda #<RichPlay\s+ldy #>RichPlay/);
    assert.match(control, /sta RichSource\+1\s+sty RichSource\+2\s+lda #1\s+sta RichBytes\s+lda #8\s+sta RichH\s+jsr RichBlit/);
    assert.match(
        bitmapCode,
        /GeosBitmapDisplayTime:\s+jmp GeosRichClock/,
    );
    assert.doesNotMatch(bitmapCode, /GeosBitmapLegacyDisplayTime:|GeosBitmapDrawSIDControl:/);
    const clock = sourceBlock(richCode, 'GeosRichClock:', 'GeosRichClockPaint:');
    assert.match(clock, /jsr RichClockSnapshot/);
    for (const state of ['Second', 'Minute', 'Hour', 'Format', 'SID']) {
        assert.match(clock, new RegExp(`lda RichClock${state}\\s+cmp RichLast${state}\\s+bne RichClockRefresh`));
    }
    assert.match(clock, /jsr RichClockPaintSnapshot[\s\S]*lda \$a0e0,x\s+cmp \$20e0,x\s+beq \+\s+sta \$20e0,x[\s\S]*cpx #96/);
    assert.match(richCode, /lda #<RichPause\s+ldy #>RichPause\s+ldx RichClockSID\s+beq \+\s+lda #<RichPlay\s+ldy #>RichPlay/);
});

test('native header begins with the clickable Teensy menu without a duplicate brand', () => {
    const bar = sourceBlock(richCode, 'GeosRichBar:', 'GeosRichMenu:');
    assert.doesNotMatch(richCode, /RichBrand|RichDeskName/);
    assert.match(richCode, /RichTeensyName: !text "TEENSY",0/);
    assert.match(richCode, /RichMenuNameLo: !byte <RichTeensyName,<RichFileName,<RichEditName,<RichViewName,<RichDiskName/);
    assert.match(richCode, /RichMenuLeft: !byte 0,48,80,112,144/);
    assert.match(richCode, /RichMenuWidth: !byte 48,32,32,32,32/);
    assert.match(richCode, /RichDropdownLeft: !byte 0,48,80,112,144/);
    assert.match(bar, /lda RichMenuLeft,x\s+sta RichX\s+lda RichMenuWidth,x\s+sta RichW/);
});

test('native clock takes one IRQ-protected TOD snapshot and releases the latch before drawing', () => {
    const snapshot = sourceBlock(richCode, 'RichClockSnapshot:', 'RichHexByte:');
    assert.match(snapshot, /php\s+sei\s+lda TODTenthSecBCD\s+lda TODHoursBCD\s+sta RichClockHour\s+lda TODMinBCD\s+sta RichClockMinute\s+lda TODSecBCD\s+sta RichClockSecond\s+lda TODTenthSecBCD/);
    assert.match(snapshot, /lda smc24HourClockDisp\+1\s+sta RichClockFormat\s+lda smcSIDPauseStop\+1\s+sta RichClockSID\s+plp\s+rts/);
    assert.doesNotMatch(snapshot, /\bjsr\b/);
    const paint = sourceBlock(richCode, 'GeosRichClockPaint:', 'RichClockSnapshot:');
    assert.match(paint, /GeosRichClockPaint:\s+jsr RichClockSnapshot\s+RichClockPaintSnapshot:/);
    assert.doesNotMatch(paint, /\b(?:lda|ldx|ldy) TOD(?:Hours|Min|Sec|TenthSec)BCD/);
    for (const state of ['Second', 'Minute', 'Hour', 'Format', 'SID']) {
        assert.match(paint, new RegExp(`lda RichClock${state}\\s+sta RichLast${state}`));
    }
});

test('native clock fits full seconds and preserves 12/24-hour midnight and noon handling', () => {
    const paint = sourceBlock(richCode, 'RichClockPaintSnapshot:', 'RichClockSnapshot:');
    assert.match(paint, /lda #4\s+sta RichX\s+lda #1\s+sta RichXHi\s+sta RichY/);
    assert.match(paint, /RichClockHourReady:\s+jsr RichHexByte\s+lda #':'\s+jsr RichChar\s+lda RichClockMinute\s+jsr RichHexByte\s+lda #':'\s+jsr RichChar\s+lda RichClockSecond\s+jsr RichHexByte/);
    assert.match(paint, /lda RichClockFormat\s+beq RichClock12\s+lda RichClockHour\s+and #\$1f\s+cmp #\$12\s+bne \+\s+lda #0\s+\+\s+bit RichClockHour\s+bpl RichClockHourReady\s+php\s+sei\s+sed\s+clc\s+adc #\$12\s+cld\s+plp/);
    assert.match(paint, /RichClock12:\s+lda RichClockHour\s+and #\$1f\s+bne RichClockHourReady\s+lda #\$12/);
    assert.match(paint, /lda RichClockFormat\s+bne RichClockDone\s+lda #'A'\s+bit RichClockHour\s+bpl \+\s+lda #'P'\s+\+\s+and #\$7f\s+jsr RichChar/);
    assert.ok(260 + '12:59:59P'.length * 6 <= 320);
});

test('off-screen layout and protected font never overwrite the displayed bitmap', () => {
    assert.match(desktopCode, /GeosCharsetRAM = GeosBitmapFontData/);
    assert.match(bitmapCode, /GeosBitmapFontData = \$4400/);
    assert.match(desktopCode, /GeosLayoutScreen = \$4000/);
    assert.match(mainCode, /MainCodeRAMEnd > \$a000/);
    assert.match(mainCode, /lda #>GeosLayoutScreen\s+sta \$0288\s+rts/);
    const conversion = sourceBlock(bitmapCode, 'GeosBitmapConvertScreen:', 'GeosBitmapCaptureFont:');
    assert.doesNotMatch(conversion, /Mouse1351Hide|and #%11101111/);
    assert.match(conversion, /jsr GeosBitmapTintSurface/);
    assert.match(richCode, /cmp \$2000,y\s+beq \+\s+RichPublishWrite:\s+sta \$2000,y/);
    assert.match(bitmapCode, /GeosBitmapPutScreenCode:\s+and #\$7f/);
});

test('bitmap display RAM is included in the menu SID-protection range', () => {
    assert.match(common, /MenuReservedRAMStart = \$2000/);
    assert.match(main, /lda #>MainCodeRAMStart/);
    assert.match(desktop, /GeosCharsetRAM = \$3800/);
    assert.match(parser, /LoadAddress < 0x4800.*LoadAddress\+XferSize >= 0x2000/);
});

test('compact cartridge and classic list retain the character-mode fallback', () => {
    assert.match(
        mainCode,
        /ListMenuItems:\s*!ifdef DesktopShell \{\s+jsr GeosSyncMenuView\s*\}\s+lda GeosViewMode\s+beq ListMenuItemsClassic\s+jmp GeosDrawDesktop/,
    );
    const textMode = sourceBlock(mainCode, 'TextScreenMemColor:', 'ScreenColorOnly:');
    assert.match(textMode, /lda\s+#0\s+sta\s+GeosBitmapActive/);
    assert.equal(immediateStoredIn(textMode, '$d018'), 0x17);
    assert.equal(immediateStoredIn(textMode, '$d016'), 0xc8);
    assert.equal(immediateStoredIn(textMode, '$d011') & 0x20, 0);
    assert.match(
        desktopCode,
        /GeosInstallMonoCharset:[\s\S]*lda\s+#\$1f[\s\S]*sta\s+VICMemSetup/,
    );
    assert.match(
        mainCode,
        /!src "source\/GeosDesktop\.s"\s*!ifdef DesktopShell \{\s*!src "source\/GeosShell\.s"\s*!src "source\/GeosFileOps\.s"\s*!src "source\/GeosBitmap\.s"\s*!src "source\/GeosWidgets\.s"\s*!src "source\/GeosDialog\.s"\s*!src "source\/GeosRich\.s"\s*!src "source\/GeosRichAssets\.s"\s*\}/,
    );
    const banner = sourceBlock(stringsCode, 'PrintBanner:', 'DisplayTime:');
    assert.match(banner, /jsr\s+TextScreenMemColor[\s\S]*jsr\s+PrintString/);
});

test('expanded desktop redraws are converted only after character layout completes', () => {
    assert.match(
        desktopCode,
        /GeosDrawDesktop:\s*!ifdef DesktopShell \{[\s\S]*jsr GeosShellDrawHome\s+jmp GeosBitmapConvertScreen/,
    );
    assert.match(
        desktopCode,
        /GeosItemsDone:\s+jsr GeosDrawStatus\s*!ifdef DesktopShell \{\s+jsr GeosShellDrawOverlay\s+jmp GeosBitmapConvertScreen/,
    );
    assert.match(
        stringsCode,
        /DisplayTime:\s*!ifdef DesktopShell \{\s+lda GeosBitmapActive\s+beq \+\s+jmp GeosBitmapDisplayTime/,
    );
});

test('desktop input routes the configured mouse port and one or two joysticks', () => {
    assert.match(main, /MouseNoMenuEvent:[\s\S]*?lda Joystick2Sample\s+lsr/);
    assert.match(mouse, /GeosInputLayout:\s*!byte rpud3InputMouse1Joy2/,
        'Mouse 1 / Joystick 2 remains the backward-compatible default');
    const mouseCode = stripComments(mouse);
    const potRouting = sourceBlock(mouseCode, 'Mouse1351SampleState:', 'MouseInputSampleDigital:');
    assert.match(potRouting, /lda GeosInputLayout\s+beq MouseInputReadPots\s+cmp #rpud3InputJoy1Joy2\s+beq MouseInputSampleDigital/);
    const routing = sourceBlock(mouseCode, 'MouseInputSampleDigital:', 'MouseInputRestoreCIA:');
    assert.match(routing, /lda GeosInputLayout\s+beq MouseInputLayoutMouse1\s+cmp #rpud3InputJoy1Mouse2\s+beq MouseInputLayoutMouse2/);
    assert.match(routing, /lda InputPort1Sample\s+and InputPort2Sample\s+ora #%11100000\s+sta Joystick2Sample/);
    assert.match(routing, /MouseInputLayoutMouse1:\s+lda InputPort1Sample\s+sta MousePort1Sample\s+lda InputPort2Sample/);
    assert.match(routing, /MouseInputLayoutMouse2:\s+lda InputPort2Sample\s+sta MousePort1Sample\s+lda InputPort1Sample/);
});

test('native artwork retains complete 5x7 glyphs and eight 24x16 source icons', () => {
    const font = sourceBlock(richAssets, 'GeosRichFont:', 'GeosRichFontEnd:');
    const icons = sourceBlock(richAssets, 'GeosRichIcons:', 'GeosRichIconsEnd:');
    const bytes = block => [...stripComments(block).matchAll(/\$([0-9a-f]{2})\b/gi)].map(match => parseInt(match[1], 16));
    assert.equal(bytes(font).length, 96 * 8);
    assert.equal(bytes(icons).length, 8 * 48);
    for (let index = 0; index < 96; index++) assert.equal(bytes(font)[index * 8 + 7], 0);
    assert.match(richAssets, /GeosRichFontWidth = 5[\s\S]*GeosRichFontHeight = 7[\s\S]*GeosRichFontAdvance = 6/);
    const pointerTable = richCode.match(/RichIconLo: !for i,0,(\d+) \{ !byte <\(GeosRichIcons\+i\*48\) \}/);
    assert.ok(pointerTable, 'native home has an indexed icon pointer table');
    assert.ok(Number(pointerTable[1]) + 1 >= 8, 'pointer table covers all eight icon assets');
    const home = sourceBlock(richCode, 'RichHomeIconLoop:', 'RichHomeIcon:');
    assert.match(home, /cmp #GeosHomeIconCount\s+bne RichHomeIconLoop/);
});

test('native frame composes under BASIC before publishing only changed bitmap bytes', () => {
    assert.match(richCode, /GeosRichCanvas = \$a000/);
    const desktopLayout = sourceBlock(stripComments(common), '!ifdef DesktopShell {', '!ifndef DesktopShell {');
    assert.match(desktopLayout, /MainCodeRAMStart\s*=\s*\$4800/);
    assert.match(desktopLayout, /GeosSettingsBase\s*=\s*\$1000/);
    for (const [name, offset] of [
        ['GeosPanelSettingsOpen', '00'], ['GeosPanelControlDraw', '03'],
        ['GeosPanelControlHitTest', '06'], ['GeosPanelControlSetSelection', '15'],
        ['GeosPanelControlHandleKey', '18'], ['GeosPanelMusicActivate', '1b'],
        ['GeosPanelMusicOpen', '1e'], ['GeosPanelControlOrigin', '21'],
    ]) assert.match(desktopLayout, new RegExp(`${name}\\s*=\\s*GeosSettingsBase\\+\\$${offset}`));
    assert.match(desktopLayout, /GeosSettingsCode\s*=\s*GeosSettingsBase\+\$24/);
    assert.match(desktopLayout, /GeosAppEntry\s*=\s*\$c000\s+GeosAppBackendAvailable\s*=\s*\$c003/);
    assert.match(mainCode, /MainCodeRAMEnd > \$a000/);
    assert.match(richCode, /GeosRichBegin:\s+lda \$01\s+sta RichSavedBank\s+and #\$fe\s+sta \$01/);
    const compose = sourceBlock(richCode, 'GeosRichCompose:', 'GeosRichPublish:');
    assert.match(compose, /jsr GeosRichHome[\s\S]*jsr GeosRichBar[\s\S]*jsr GeosRichPublish\s+jsr GeosBitmapPublishColors[\s\S]*jsr GeosMenuPaint\s+\+\s+lda RichSavedBank\s+sta \$01\s+lda GeosNotice/);
    assert.doesNotMatch(sourceBlock(richCode, 'GeosRichCompose:', 'RichComposeDone:'), /jsr GeosRichMenu/);
    assert.match(compose, /sta GeosOverlayMode[\s\S]*jmp GeosBitmapShowMessage/);
    const publish = sourceBlock(richCode, 'GeosRichPublish:', 'RichAddress:');
    assert.match(publish, /ldx #31[\s\S]*lda \$a000,y[\s\S]*cmp \$2000,y\s+beq \+[\s\S]*sta \$2000,y/);
    assert.match(publish, /lda \$bf00,y\s+cmp \$3f00,y\s+beq \+\s+sta \$3f00,y[\s\S]*cpy #64/);
    assert.doesNotMatch(publish, /\$d011|\$d016|VICMemSetup|GeosRichHome/);
    assert.match(bitmapCode, /GeosBitmapConvertScreen:\s+jsr GeosRichBegin/);
    assert.match(richCode, /GeosRichCanvas = \$a000/);
});

test('desktop SID IRQ restores the interrupted BASIC bank mapping', () => {
    const irq = sourceBlock(sidCode, 'IRQwedge:', 'smcIRQDefault');
    assert.match(irq, /!ifdef DesktopShell \{\s+lda \$01\s+pha\s*\}\s+lda #\$35\s+sta \$01/);
    assert.match(irq, /!ifdef DesktopShell \{\s+pla\s*\}\s*!ifndef DesktopShell \{\s+lda #\$37\s*\}\s+sta \$01/);
    const clock = sourceBlock(richCode, 'GeosRichClock:', 'GeosRichClockPaint:');
    assert.match(clock, /jsr GeosRichBegin[\s\S]*lda RichSavedBank\s+sta \$01\s+rts/);
});
