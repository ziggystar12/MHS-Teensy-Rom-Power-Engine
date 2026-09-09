'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const c64Dir = path.join(__dirname, '..', '..');
const teensyDir = path.join(c64Dir, '..', 'Teensy');
const settings = fs.readFileSync(
    path.join(c64Dir, 'SettingsMenu', 'source', 'SettingsMenu.asm'),
    'utf8',
);
const mainMenu = fs.readFileSync(
    path.join(c64Dir, 'MainMenuCRT', 'source', 'MainMenu.asm'),
    'utf8',
);
const driveDirLoad = fs.readFileSync(path.join(teensyDir, 'DriveDirLoad.ino'), 'utf8');
const flashUpdate = fs.readFileSync(path.join(teensyDir, 'FlashUpdate.ino'), 'utf8');
const sid = fs.readFileSync(path.join(c64Dir, 'MainMenuCRT', 'source', 'SIDRelated.s'), 'utf8');
const dialog = fs.readFileSync(path.join(c64Dir, 'MainMenuCRT', 'source', 'GeosDialog.s'), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);

    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

test('SettingsMenu consumes only valid bit-7 page requests and defaults to page zero', () => {
    assert.match(settings, /NumPages\s*=\s*9\b/);

    const startupRoute = sourceBlock(settings, ';Normal launches always start', 'bPageNum:');
    assert.match(startupRoute, /lda #0\s+sta bPageNum/);
    assert.match(
        startupRoute,
        /lda rwRegScratch\+IO1Port\s+bmi InitialPageRequest\s+jmp PageUpdate/,
    );
    assert.match(
        startupRoute,
        /InitialPageRequest:\s+and #\$7f\s+cmp #NumPages\s+bcs ClearInitialPageRequest\s+sta bPageNum/,
    );
    assert.match(
        startupRoute,
        /ClearInitialPageRequest:\s+lda #0\s+sta rwRegScratch\+IO1Port\s+jmp PageUpdate/,
    );
});

test('compact firmware recovery restores scanning; desktop confirmation retains the mouse IRQ', () => {
    const disable = sourceBlock(sid, 'IRQDisable:', '\nSIDVoicesOff:').replace(/;[^\r\n]*/g, '');
    assert.match(disable, /^IRQDisable:\s+sei/);
    assert.match(disable, /lda #0\s+sta CIA1_DDRB\s+lda #\$ff\s+sta CIA1_DDRA\s+cli/);
    assert.ok(disable.indexOf('sta CIA1_DDRB') < disable.indexOf('cli'));
    const runSelected = sourceBlock(mainMenu, 'RunSelected:', '\nListAndDone');
    assert.ok(runSelected.indexOf('jsr IRQDisable') < runSelected.indexOf('lda #<MsgFWVerify'));
    const binary = sourceBlock(runSelected, 'RunSelectedBinary:', 'RunSelectedBinaryLegacy:');
    assert.ok(binary.indexOf('jmp GeosFirmwareConfirm') < binary.indexOf('jsr IRQDisable'));
    const firmware = sourceBlock(dialog, 'GeosFirmwareConfirm:', 'GeosFirmwareDone:');
    assert.match(firmware, /lda #rCtlFirmwarePrepareWAIT\s+jsr GeosFirmwareRequest\s+bne GeosFirmwareChanged/);
    assert.match(firmware, /lda #rsstFirmwareName\s+jsr GeosDialogSerial/);
    assert.match(firmware, /jsr GeosDialogWait\s+cmp #2\s+bne GeosFirmwareDone\s+lda #rCtlFirmwareCheckWAIT\s+jsr GeosFirmwareRequest\s+bne GeosFirmwareChanged[\s\S]*jsr IRQDisable\s+jsr StartSelItem_WaitForTRDots/);
});

test('compact RunSelected retains its explicit lowercase y/n firmware gate', () => {
    const runSelected = sourceBlock(mainMenu, 'RunSelected:', '\nListAndDone');
    const hexCheck = runSelected.indexOf('cmp #rtFileHex');
    const prompt = runSelected.indexOf('lda #<MsgFWVerify');
    const waitForKey = runSelected.indexOf('jsr GetIn', prompt);
    const noChoice = runSelected.indexOf("cmp #'n'", waitForKey);
    const cancel = runSelected.indexOf('jsr IRQEnable', noChoice);
    const yesChoice = runSelected.indexOf("cmp #'y'", cancel);
    const warning = runSelected.indexOf('lda #<MsgFWInProgress', yesChoice);
    const startUpdate = runSelected.indexOf('jsr StartSelItem_WaitForTRDots', warning);

    for (const [name, index] of Object.entries({
        hexCheck,
        prompt,
        waitForKey,
        noChoice,
        cancel,
        yesChoice,
        warning,
        startUpdate,
    })) {
        assert.notEqual(index, -1, `missing ${name} in RunSelected`);
    }
    assert.ok(
        hexCheck < prompt
            && prompt < waitForKey
            && waitForKey < noChoice
            && noChoice < cancel
            && cancel < yesChoice
            && yesChoice < warning
            && warning < startUpdate,
        'the .hex prompt, cancel, confirmation, warning, and start must remain ordered',
    );
    assert.match(runSelected, /cmp #'n'\s+bne \+\+\s+jsr IRQEnable\s+jmp ListAndDone/);
    assert.match(runSelected, /\+\+ cmp #'y'\s+bne -/);
});

test('both SD and USB .hex selections reach DoFlashUpdate with their source filesystem', () => {
    const removableMedia = sourceBlock(driveDirLoad, 'FS *sourceFS', 'case rmtTeensy:');
    assert.match(
        removableMedia,
        /FS \*sourceFS\s*=\s*&firstPartition;[\s\S]*case rmtSD:\s+sourceFS\s*=\s*&SD;\s+case rmtUSBDrive:/,
    );
    assert.match(
        removableMedia,
        /if \(MenuSelCpy\.ItemType == rtFileHex\)[\s\S]*DoFlashUpdate\(sourceFS, FullFilePath, expectedFirmwareCRC, verifyFirmwareCRC\);\s+return;/,
    );

    const doFlashUpdate = sourceBlock(flashUpdate, 'void DoFlashUpdate', '\nbool isFab2x');
    assert.match(doFlashUpdate, /File hexFile\s*=\s*sourceFS->open\(FilePathName, FILE_READ\s*\);/);
    assert.match(
        doFlashUpdate,
        /update_firmware\(\s*&hexFile,\s*&Serial,\s*buffer_addr,\s*buffer_size,\s*expectedCRC,\s*verifyCRC\s*\);/,
    );
});
