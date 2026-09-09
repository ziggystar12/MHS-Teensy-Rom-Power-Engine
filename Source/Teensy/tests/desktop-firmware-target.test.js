'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
test('firmware confirmation and startup discovery reject changed or unconfirmed starts',t=>{
  const compiler=[process.env.CXX,'g++','clang++','C:/msys64/mingw64/bin/g++.exe'].filter(Boolean)
    .find(candidate=>spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0);
  assert.ok(compiler,'C++11 host compiler required');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'firmware-target-'));
  try {
    const execution=fs.readFileSync(path.join(__dirname,'../DriveDirLoad.ino'),'utf8');
    const begin=execution.indexOf('void HandleExecution()');
    const end=execution.indexOf('\nvoid MenuChange()',begin);
    assert.ok(begin>=0 && end>begin,'production HandleExecution body is available');
    fs.writeFileSync(path.join(temporary,'handle-execution-under-test.h'),execution.slice(begin,end));
    const directoryBegin=execution.indexOf('static DriveDirNamePool DriveDirNames');
    const directoryEnd=execution.indexOf('\nvoid FreeCrtChips()',directoryBegin);
    assert.ok(directoryBegin>=0 && directoryEnd>directoryBegin,'production directory population is available');
    fs.writeFileSync(path.join(temporary,'drive-directory-under-test.h'),execution.slice(directoryBegin,directoryEnd));
    const operations=fs.readFileSync(path.join(__dirname,'../MinimalBoot/Common/IO_Handlers/DesktopFileOps.c'),'utf8');
    const commandBegin=operations.indexOf('FLASHMEM void DesktopFileCommand()');
    const commandEnd=operations.indexOf('\nFLASHMEM void DesktopFilePoll()',commandBegin);
    assert.ok(commandBegin>=0 && commandEnd>commandBegin,'production file-command body is available');
    fs.writeFileSync(path.join(temporary,'file-command-under-test.h'),operations.slice(commandBegin,commandEnd));
    const output=path.join(temporary,'guard.exe');
    const env={...process.env,PATH:path.dirname(compiler)+path.delimiter+process.env.PATH};
    const build=spawnSync(compiler,['-std=c++11','-Wall','-Wextra','-Werror','-Wno-implicit-fallthrough','-I',temporary,path.join(__dirname,'desktop-firmware-target.cpp'),'-o',output],{encoding:'utf8',env});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const firmwareDir=path.resolve(__dirname,'../../../firmware');
    const versionHeader=fs.readFileSync(path.join(__dirname,'../DesktopFirmwareVersion.h'),'utf8');
    const installed=versionHeader.match(/^#define MPE_FIRMWARE_VERSION "([^"]+)"/m)?.[1];
    assert.ok(installed,'current firmware version is declared');
    const official=fs.existsSync(firmwareDir)?fs.readdirSync(firmwareDir).filter(name=>
      name.toLowerCase()===`mpe_firmware-v${installed}.hex`):[];
    if(fs.existsSync(firmwareDir)&&official.length) assert.equal(official.length,1,'one current firmware fixture');
    const candidateDir=path.resolve(__dirname,'../../../DosTest/firmware');
    const candidates=fs.existsSync(candidateDir)?fs.readdirSync(candidateDir).filter(name=>/^MPE_Firmware-V.*\.hex$/i.test(name)):[];
    const fixtures=[...official.map(name=>path.join(firmwareDir,name)),...candidates.map(name=>path.join(candidateDir,name))];
    t.diagnostic(fixtures.length ? `SDIO preflight checks ${fixtures.length} complete local firmware HEX files` :
      'isolated source tree: SDIO preflight uses the 6 MiB synthetic stream fixture');
    const run=spawnSync(output,fixtures,{encoding:'utf8',env});
    assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/33 firmware target checks passed/);
    assert.match(run.stdout,/77 firmware discovery checks passed/);
    assert.match(run.stdout,/24 browser firmware reinstall checks passed/);
    assert.match(run.stdout,new RegExp(`${(fixtures.length+1)*4+2} firmware SDIO stream checks passed`));
    t.diagnostic(run.stdout.trim());
    const handlers=fs.readFileSync(path.join(__dirname,'../MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c'),'utf8');
    assert.match(handlers,/case rCtlFirmwarePrepareWAIT:\s+case rCtlFirmwareCheckWAIT:[\s\S]*?rsFirmwareTarget/);
    assert.match(handlers,/case rCtlFirmwareDiscoverWAIT:\s+IO1\[wRegControl\] = Data;\s+IO1\[rwRegStatus\] = rsFirmwareTarget/);
    assert.match(handlers,/case rCtlFirmwareCancel:\s+[\s\S]*?IO1\[wRegControl\] = Data;\s+DesktopFirmwareCancel\(\)/);
    assert.match(execution,/if \(capturedFirmware\) \{\s+if \(!DesktopFirmwareBegin\(MenuSelCpy, launchSource\)\) return;[\s\S]*?if \(!DesktopFirmwareExpectedCRC\(expectedFirmwareCRC\)\) return;\s+verifyFirmwareCRC = true/);
    assert.match(execution,/switch\(launchSource\)/);assert.match(execution,/DesktopFirmware\.pathName\(FullFilePath/);
    assert.doesNotMatch(execution.slice(begin,end),/sprintf\(FullFilePath/);
    assert.match(handlers,/void InitHndlr_TeensyROM\(\)\s*\{\s*DesktopFirmwareCancel\(\)/);
    assert.match(handlers,/DesktopFirmwareCancel\(\);\s*DesktopFirmwareResetDiscovery\(\)/);
  } finally { assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));fs.rmSync(temporary,{recursive:true,force:true}); }
});
