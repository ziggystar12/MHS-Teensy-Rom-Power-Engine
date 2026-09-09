'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('appearance preferences and fixed storage snapshots use the production protocol', t => {
  const compiler = [process.env.CXX, 'g++', 'clang++', 'C:/msys64/mingw64/bin/g++.exe'].filter(Boolean)
    .find(candidate => spawnSync(candidate, ['--version'], {encoding: 'utf8'}).status === 0);
  assert.ok(compiler, 'C++11 host compiler required');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-storage-settings-'));
  try {
    const executable = path.join(temporary, process.platform === 'win32' ? 'settings.exe' : 'settings');
    const environment = {...process.env, PATH: path.dirname(compiler) + path.delimiter + process.env.PATH};
    const build = spawnSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror',
      path.join(__dirname, 'desktop-storage-settings.cpp'), '-o', executable],
      {encoding: 'utf8', env: environment});
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(executable, [], {encoding: 'utf8', env: environment});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /\d+ appearance and storage protocol scenarios passed/);
    t.diagnostic(run.stdout.trim());
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

test('firmware queues media work outside the IO interrupt and publishes state last', () => {
  const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const registers = source('MinimalBoot/Common/Menu_Regs.h');
  const handler = source('MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c');
  const storage = source('MinimalBoot/Common/IO_Handlers/DesktopStorage.c');
  const status = source('MinimalBoot/Common/IO_Handlers/StatusFunctions.c');
  const startup = source('Teensy.ino');

  assert.match(registers, /rCtlStorageRefreshWAIT\s*=\s*65\b/);
  assert.match(registers, /rRegStorageState\s*=\s*112\b[\s\S]*?rRegStorageInternalFreeKiB3\s*=\s*144\b[\s\S]*?rwRegDesktopAppID\s*=\s*145\b[\s\S]*?IO1Size\s*=\s*146\b/);
  assert.match(registers, /rsStorageSnapshot\s*=\s*0x23\b[\s\S]*?rsNumStatusTypes\s*=\s*0x24\b/);
  assert.match(handler, /#include "DesktopStorage\.c"\s*\n#include "StatusFunctions\.c"/);
  assert.match(handler, /case rCtlStorageRefreshWAIT:\s*IO1\[rRegStorageState\] = 0;\s*IO1\[rwRegStatus\] = rsStorageSnapshot;\s*break;/);
  assert.match(status, /&DesktopStorageRefresh,\s*\/\/ rsStorageSnapshot/);
  assert.doesNotMatch(handler.match(/case rCtlStorageRefreshWAIT:[\s\S]*?break;/)[0],
    /SDFullInit|totalSize|usedSize|myDrive/, 'no filesystem calls in the IO interrupt');

  const refresh = storage.match(/FLASHMEM void DesktopStorageRefresh\(\)[\s\S]*?\n}/)?.[0];
  assert.ok(refresh, 'storage refresh implementation');
  assert.match(refresh, /DesktopStorageObserveSD\(\)[\s\S]*DesktopStorageObserveUSB\(\)/);
  assert.match(storage, /DesktopInternalFlashEnd\s*=\s*0x607c0000ULL/);
  assert.match(refresh, /internalOrigin\s*=\s*BootData\[0\][\s\S]*DesktopInternalFlashEnd\s*-\s*internalOrigin/);
  assert.match(refresh, /IO1\[rRegStorageState\] = 0;/);
  const finalState = refresh.lastIndexOf('IO1[rRegStorageState] = snapshot.state;');
  assert.ok(finalState > refresh.lastIndexOf('DesktopStoragePublishU32('));
  assert.ok(finalState > refresh.lastIndexOf('IO1[rRegStorageUSBProductHi]'));
  assert.match(startup, /static bool SDCardInsertedFast\(\)[\s\S]*?bool DesktopStorageSDCardInsertedFast\(\)/);
});

test('appearance bits retain the existing deferred EEPROM persistence and compatible defaults', () => {
  const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const registers = source('MinimalBoot/Common/Menu_Regs.h');
  const handler = source('MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c');
  const startup = source('Teensy.ino');
  const writeCase = handler.match(/case rwRegPwrUpDefaults3:[\s\S]*?break;/)?.[0];
  assert.ok(writeCase, 'power-up-defaults register write');
  assert.match(writeCase, /eepAddrToWrite = eepAdPwrUpDefaults3;/);
  assert.match(writeCase, /IO1\[rwRegStatus\] = rsWriteEEPROM/);
  assert.match(startup, /IO1\[rwRegPwrUpDefaults3\]\s*=\s*EEPROM\.read\(eepAdPwrUpDefaults3\);/);
  assert.match(startup, /EEPROM\.write\(eepAdPwrUpDefaults3,\s*0x00\);/);
  assert.match(registers, /rpud3AppearanceDark\s*=\s*0b00001000/);
  assert.match(registers, /rpud3BackgroundMask\s*=\s*0b00110000/);
  assert.match(registers, /rpud3BackgroundDots\s*=\s*0b00000000/);
  assert.match(registers, /rpud3BackgroundDithered\s*=\s*0b00010000/);
  assert.match(registers, /rpud3BackgroundBlank\s*=\s*0b00100000/);
});
