'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {mkdtempSync, rmSync, readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');

test('production directory policy handles 4,000 entries, case, pooled names and SD lifecycle', () => {
  const compilers = [process.env.CXX, 'g++', 'clang++', 'C:/msys64/mingw64/bin/g++.exe'].filter(Boolean);
  const compiler = compilers.find(candidate => spawnSync(candidate, ['--version'], {encoding: 'utf8'}).status === 0);
  assert.ok(compiler, 'Set CXX to a C++11-capable host compiler');
  const directory = mkdtempSync(path.join(tmpdir(), 'tr-drive-directory-'));
  const executable = path.join(directory, process.platform === 'win32' ? 'drive-directory.exe' : 'drive-directory');
  const environment = {...process.env, PATH: path.dirname(compiler) + path.delimiter + process.env.PATH};
  try {
    const build = spawnSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror',
      path.join(__dirname, 'drive-directory.cpp'), '-o', executable], {encoding: 'utf8', env: environment});
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(executable, [], {encoding: 'utf8', env: environment});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /\d+ drive directory and SD mount scenarios passed/);
    console.log(run.stdout.trim());
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('firmware wires the optimized policy into every SD directory refresh', () => {
  const source = name => readFileSync(path.join(__dirname, '..', name), 'utf8');
  const loader = source('DriveDirLoad.ino');
  const firmware = source('Teensy.ino');
  const diskImages = source('D64.ino');
  assert.match(loader, /qsort\(DriveDirMenu, NumDrvDirMenuItems, sizeof\(StructMenuItem\), CompareDriveDirMenuItems\)/);
  assert.doesNotMatch(loader, /for\s*\([^)]*i[^)]*NumDrvDirMenuItems[^)]*\)\s*for\s*\([^)]*j/s);
  assert.match(loader, /void InitDriveDirMenu\(bool PoolNames\)[\s\S]*?DriveDirNamesPooled = PoolNames/);
  assert.match(loader, /void LoadDirectory\(FS \*sourceFS\)\s*\{\s*InitDriveDirMenu\(true\);\s*if \(sourceFS == &SD\) SDFullInit\(\)/);
  assert.match(loader, /uint8_t Assoc_Ext_ItemType\(const char \*FileName\)/);
  assert.match(diskImages, /Name = AllocDriveDirName\(DxxFNB_Bytes\)/);
  assert.match(diskImages, /LoadDxxDirectory\([\s\S]*?InitDriveDirMenu\(true\)/);
  assert.doesNotMatch(diskImages, /Name = \(char\*\)malloc\(DxxFNB_Bytes\)/);
  assert.doesNotMatch(loader, /\*cnt\s*\+=\s*32|tolower\s*\(\s*\*?Extension/);
  assert.match(loader, /FS \*sourceFS = &firstPartition;\s*if \(launchSource == rmtSD\) SDFullInit\(\)/);
  assert.doesNotMatch(loader.match(/void MenuChange\(\)[\s\S]*?\n}/)[0], /SD\.begin/);
  assert.match(firmware, /static bool SDCardInsertedFast\(\)[\s\S]*?pinMode\(46, INPUT_PULLDOWN\);\s*delayMicroseconds\(5\);\s*return digitalReadFast\(46\)/);
  assert.match(firmware, /if \(Decision == DriveSDUseMounted\)[\s\S]*?return true;\s*}\s*if \(Decision == DriveSDNoCard\)/);
  assert.match(firmware, /uint32_t SDMediaGeneration\(\)[\s\S]*?return SDObservedGeneration/);
  assert.match(firmware, /DriveSDMountRetryAllowed\(SDLastObservedState == SDObservedError,[\s\S]*?SDErrorGeneration = SDObservedGeneration/);
  assert.match(loader, /case rmtSD:\s*SDRequestExplicitRefresh\(\);\s*LoadDirectory\(&SD\)/);
  for (const name of ['FileTransfer.ino', 'nfcScan.ino',
    'MinimalBoot/Common/IO_Handlers/IOH_TR_BASIC.c',
    'MinimalBoot/Common/IO_Handlers/Swift_Browser.c']) {
    assert.doesNotMatch(source(name), /SD\.begin\(BUILTIN_SDCARD\)/, `${name}: use cached SDFullInit`);
  }
});
