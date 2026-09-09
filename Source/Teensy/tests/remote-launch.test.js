'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('production remote launch preserves root filenames through direct and menu launch routes', t => {
  const source = fs.readFileSync(path.join(__dirname, '../RemoteControl.ino'), 'utf8');
  const launch = source.match(/void RemoteLaunch\(RegMenuTypes[^\n]*\n\{[\s\S]*?\n}/)?.[0];
  assert.ok(launch, 'production RemoteLaunch body is available');
  const compiler = [process.env.CXX, 'g++', 'clang++', 'C:/msys64/mingw64/bin/g++.exe'].filter(Boolean)
    .find(candidate => spawnSync(candidate, ['--version'], {encoding: 'utf8'}).status === 0);
  assert.ok(compiler, 'C++11 host compiler required');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-launch-'));
  try {
    const fixture = path.join(temporary, 'remote-launch.cpp');
    fs.writeFileSync(fixture, `
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include "Menu_Regs.h"
#define Printf_dbg(...) ((void)0)
uint8_t IO1[256] = {};
char DriveDirPath[256], SelectedName[256];
bool RemoteLaunched, SendC64Msgs = true, doReset;
uint16_t NumDrvDirMenuItems, SelItemFullIdx;
unsigned CurrentIOHandler = IOH_TeensyROM, directCalls, irqCalls, resetCalls;
char cartName[] = "C64TEST.crt", directoryName[] = "/Utilities";
StructMenuItem builtinDirectory[] = {{rtFileCrt, 0, cartName, nullptr, 0}};
StructMenuItem TeensyROMMenu[] = {
  {rtFileCrt, 0, cartName, nullptr, 0},
  {rtDirectory, 0, directoryName, reinterpret_cast<uint8_t*>(builtinDirectory), sizeof(builtinDirectory)}
};
StructMenuItem DriveDirMenu[1] = {}, *MenuSource;
struct SerialMock { void printf(const char*, ...) {} } Serial;
void SDFullInit() {}
void USBFileSystemWait() {}
void FreeCrtChips() {}
void FreeSwiftlinkBuffs() {}
void InitDriveDirMenu(bool pooled) { assert(!pooled); }
void SetNumItems(unsigned) {}
void SetCursorToItemNum(uint16_t item) { IO1[rwRegCursorItemOnPg] = item; }
int16_t FindTRMenuItem(StructMenuItem* menu, uint16_t count, const char* name) {
  for (uint16_t i = 0; i < count; ++i) if (!std::strcmp(menu[i].Name, name)) return i;
  return -1;
}
void SetDriveDirMenuNameType(unsigned item, const char* name) {
  assert(item == 0 && std::strlen(name) < sizeof(SelectedName));
  std::strcpy(SelectedName, name);
  DriveDirMenu[0] = {rtFileCrt, 0, SelectedName, nullptr, 0};
}
void HandleExecution() { ++directCalls; doReset = true; }
bool InterruptC64(unsigned command) { assert(command == ricmdLaunch); ++irqCalls; return true; }
void SetUpMainMenuROM() { ++resetCalls; doReset = true; }
${launch}
int main() {
  struct Scenario { RegMenuTypes source; const char* input; const char* directory; const char* filename; };
  const Scenario cases[] = {
    {rmtSD, "/DOOMVM.crt", "/", "DOOMVM.crt"},
    {rmtSD, "/NESVM.crt", "/", "NESVM.crt"},
    {rmtSD, "DOOMVM.crt", "/", "DOOMVM.crt"},
    {rmtSD, "/Games/NESVM.crt", "/Games", "NESVM.crt"},
    {rmtUSBDrive, "/C64TEST.crt", "/", "C64TEST.crt"},
    {rmtUSBDrive, "/Games/C64TEST.crt", "/Games", "C64TEST.crt"},
    {rmtTeensy, "/C64TEST.crt", "/", "C64TEST.crt"},
    {rmtTeensy, "/Utilities/C64TEST.crt", "/Utilities", "C64TEST.crt"}
  };
  unsigned checks = 0;
  for (const auto& scenario : cases) for (unsigned route = 0; route < 3; ++route) {
    char input[256]; std::strcpy(input, scenario.input);
    std::strcpy(DriveDirPath, "/old/location");
    std::memset(IO1, 0, sizeof(IO1));
    SelectedName[0] = 0; MenuSource = nullptr; SelItemFullIdx = 0;
    RemoteLaunched = doReset = false; SendC64Msgs = true;
    directCalls = irqCalls = resetCalls = 0;
    CurrentIOHandler = route == 2 ? IOH_TeensyROM + 1 : IOH_TeensyROM;
    RemoteLaunch(scenario.source, input, route == 0);
    assert(!std::strcmp(DriveDirPath, scenario.directory));
    assert(MenuSource && !std::strcmp(MenuSource[SelItemFullIdx].Name, scenario.filename));
    assert(!std::strcmp(input, scenario.input));
    assert(IO1[rWRegCurrMenuWAIT] == scenario.source && RemoteLaunched && SendC64Msgs);
    assert(directCalls == (route == 0) && irqCalls == (route == 1) && resetCalls == (route == 2));
    if (route == 2) assert(IO1[rwRegIRQ_CMD] == ricmdLaunch);
    ++checks;
  }
  std::printf("%u production remote launch scenarios passed\\n", checks);
}
`);
    const executable = path.join(temporary, process.platform === 'win32' ? 'launch.exe' : 'launch');
    const env = {...process.env, PATH: path.dirname(compiler) + path.delimiter + process.env.PATH};
    const built = spawnSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I',
      path.join(__dirname, '../MinimalBoot/Common'), fixture, '-o', executable], {encoding: 'utf8', env});
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const run = spawnSync(executable, [], {encoding: 'utf8', env});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /24 production remote launch scenarios passed/);
    t.diagnostic(run.stdout.trim());
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
