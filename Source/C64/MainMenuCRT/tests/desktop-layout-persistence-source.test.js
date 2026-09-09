'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '../../..');
const menuRegs = fs.readFileSync(path.join(sourceRoot, 'Teensy/MinimalBoot/Common/Menu_Regs.h'), 'utf8');
const menuRegsI = fs.readFileSync(path.join(__dirname, '../source/Menu_Regs.i'), 'utf8');
const commonDefs = fs.readFileSync(path.join(sourceRoot, 'Teensy/MinimalBoot/Common/Common_Defs.h'), 'utf8');
const teensy = fs.readFileSync(path.join(sourceRoot, 'Teensy/Teensy.ino'), 'utf8');
const handler = fs.readFileSync(path.join(sourceRoot, 'Teensy/MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c'), 'utf8');

test('desktop registers occupy IO1 offsets 53 through 62 in both register maps', () => {
  for (const source of [menuRegs, menuRegsI]) {
    assert.match(source, /NumDesktopSlots\s*=*\s*9\b/);
    assert.match(source, /rwRegDesktopFlags\s*=\s*53\b/);
    assert.match(source, /rwRegDesktopSlotStart\s*=\s*54\b/);
  }
});

test('desktop persistence has an independent versioned EEPROM block', () => {
  assert.match(commonDefs, /#define\s+eepMagicNum\s+0xfeed6415\b/);
  assert.match(commonDefs, /#define\s+eepDesktopLayoutVersion\s+1\b/);
  assert.match(commonDefs, /eepAdDesktopVersion\s*=\s*4235\b/);
  assert.match(commonDefs, /eepAdDesktopFlags\s*=\s*4236\b/);
  assert.match(commonDefs, /eepAdDesktopSlotStart\s*=\s*4237\b/);
  assert.match(commonDefs, /eepAdNext\s*=\s*4246\b/);
});

test('full firmware initializes and loads desktop defaults', () => {
  assert.match(teensy, /EEPROM\.read\(eepAdDesktopVersion\)\s*!=\s*eepDesktopLayoutVersion/);
  assert.match(teensy, /IO1\[rwRegDesktopFlags\]\s*=\s*EEPROM\.read\(eepAdDesktopFlags\)/);
  assert.match(teensy, /IO1\[rwRegDesktopSlotStart\+slot\]\s*=\s*EEPROM\.read\(eepAdDesktopSlotStart\+slot\)/);
  assert.match(teensy, /EEPROM\.write\(eepAdDesktopFlags,\s*0\)/);
  assert.match(teensy, /EEPROM\.write\(eepAdDesktopSlotStart\+slot,\s*slot\)/);
  assert.match(teensy, /EEPROM\.write\(eepAdDesktopVersion,\s*eepDesktopLayoutVersion\)/);
});

test('desktop register writes use the deferred one-byte EEPROM path', () => {
  assert.match(handler, /case\s+rwRegDesktopFlags\s+\.\.\.\s+\(rwRegDesktopSlotStart\+NumDesktopSlots-1\):/);
  assert.match(handler, /eepAddrToWrite\s*=\s*Address-rwRegDesktopFlags\s*\+eepAdDesktopFlags/);
  assert.match(handler, /eepDataToWrite\s*=\s*Data/);
  assert.match(handler, /IO1\[rwRegStatus\]\s*=\s*rsWriteEEPROM/);
});
