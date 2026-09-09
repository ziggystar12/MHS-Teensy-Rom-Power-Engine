'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');

test('Final Cartridge III is routed, registered and configured like other freezers', () => {
  assert.match(read('MinimalBoot/Common/DriveDirLoad.h'), /Cart_FinalCartridgeIII,\s*IOH_FinalCartridgeIII/);
  const handlers = read('MinimalBoot/Common/IOHandlers.h');
  assert.match(handlers, /#include "IO_Handlers\/IOH_FinalCartridgeIII.c"/);
  assert.match(handlers, /&IOHndlr_FinalCartridgeIII,/);
  assert.match(read('MinimalBoot/Common/Menu_Regs.h'), /IOH_FinalCartridgeIII,/);
  assert.match(read('FileParsers.ino'), /IOH_SuperSnapshotV5 \|\|\s*IO1\[rwRegNextIOHndlr\] == IOH_FinalCartridgeIII/);
});

test('original TR gets the corrected Alternate-button default; TR+ keeps autolaunch', () => {
  const startup = read('Teensy.ino');
  assert.match(startup, /#ifdef Fab04_REU\s+EEPROM.write\(eepAdPwrUpDefaults2, rpud2AltBtnAutoLaunch\)/);
  assert.match(startup, /#else\s+EEPROM.write\(eepAdPwrUpDefaults2, rpud2AltBtnNone\)/);
  assert.doesNotMatch(startup, /RecoveryFlashAtPowerOn|RecoveryFirmwarePath|RESTORE\.HEX/);
});

test('upstream launch fixes and flash headroom check remain connected', () => {
  assert.match(read('DriveDirLoad.ino'), /FLASHMEM void HandleExecution\(/);
  assert.match(read('DriveDirLoad.ino'), /FLASHMEM __attribute__\(\(noinline\)\) bool LoadFile\(/);
  assert.match(read('tools/Build-DualBoot.ps1'), /Invoke-HexCombine\s+Invoke-FlashHeadroomCheck/);
  assert.match(read('tools/Test-FlashHeadroom.ps1'), /SteadyStateMax/);
});
