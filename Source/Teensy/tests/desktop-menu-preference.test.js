'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('the saved text-menu bit uses the existing deferred EEPROM path and survives reboot', t => {
    const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    const handler = source('MinimalBoot/Common/IO_Handlers/IOH_TeensyROM.c');
    const status = source('MinimalBoot/Common/IO_Handlers/StatusFunctions.c');
    const startup = source('Teensy.ino');
    const definition = source('MinimalBoot/Common/Common_Defs.h');
    const registers = source('MinimalBoot/Common/Menu_Regs.h');
    const match = (text, expression) => {
        const result = text.match(expression);
        assert.ok(result, expression.toString());
        return result[0];
    };
    const writeCase = match(handler, /case rwRegPwrUpDefaults3:[\s\S]*?break;/);
    const write = match(status, /FLASHMEM void WriteEEPROM\(\)\s*\{[^}]*\}/);
    const load = match(startup, /IO1\[rwRegPwrUpDefaults3\]\s*=\s*EEPROM\.read\(eepAdPwrUpDefaults3\);/);
    const defaults = match(startup, /EEPROM\.write\(eepAdPwrUpDefaults3,\s*0x00\);/);
    const address = match(definition, /eepAdPwrUpDefaults3\s*=\s*\d+/);
    assert.match(status, /&WriteEEPROM,\s*\/\/ rsWriteEEPROM/);
    assert.match(registers, /rpud3TextMenu\s*=\s*0b00000001/);
    const compiler = [process.env.CXX, 'g++', 'clang++', 'C:/msys64/mingw64/bin/g++.exe'].filter(Boolean)
        .find(candidate => spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0);
    assert.ok(compiler, 'C++11 host compiler required');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-preference-'));
    try {
        const fixture = path.join(temporary, 'preference.cpp');
        fs.writeFileSync(fixture, `
#include <cstdint>
#include <cassert>
#include <cstdio>
#include "Menu_Regs.h"
#define FLASHMEM
#define Printf_dbg(...) ((void)0)
enum { ${address} };
uint8_t IO1[256] = {}, eepDataToWrite = 0;
unsigned eepAddrToWrite = 0;
struct Eeprom {
    uint8_t data[5000] = {};
    unsigned writes = 0, address = 0;
    void write(unsigned at, uint8_t value) { assert(at < sizeof(data)); data[at] = value; address = at; ++writes; }
    uint8_t read(unsigned at) { assert(at < sizeof(data)); return data[at]; }
} EEPROM;
void registerWrite(unsigned address, uint8_t Data) {
    switch (address) { ${writeCase} default: assert(false); }
}
${write}
void bootLoad() { ${load} }
void defaults() { ${defaults} }
int main() {
    static_assert(rpud3TextMenu == 1 && rpud3ResetDetectDisable == 128, "stable independent bits");
    static_assert(rwRegPwrUpDefaults3 == 52 && eepAdPwrUpDefaults3 == 4234, "existing persisted slot");
    EEPROM.data[eepAdPwrUpDefaults3] = 255;
    defaults(); bootLoad();
    assert(IO1[rwRegPwrUpDefaults3] == 0); // GUI and reset detection remain the compatible defaults.
    for (unsigned original = 0; original < 256; ++original) {
        EEPROM.data[eepAdPwrUpDefaults3] = original;
        bootLoad();
        assert(IO1[rwRegPwrUpDefaults3] == original); // no migration resets older preferences
        for (unsigned toggle = 0; toggle < 2; ++toggle) {
            const uint8_t before = IO1[rwRegPwrUpDefaults3];
            const uint8_t selected = before ^ rpud3TextMenu;
            const unsigned writesBefore = EEPROM.writes;
            registerWrite(rwRegPwrUpDefaults3, selected);
            assert(EEPROM.writes == writesBefore); // ISR schedules; main loop owns EEPROM
            assert(IO1[rwRegPwrUpDefaults3] == selected && IO1[rwRegStatus] == rsWriteEEPROM);
            assert(eepAddrToWrite == eepAdPwrUpDefaults3 && eepDataToWrite == selected);
            WriteEEPROM();
            assert(EEPROM.writes == writesBefore + 1 && EEPROM.address == eepAdPwrUpDefaults3);
            assert((EEPROM.data[eepAdPwrUpDefaults3] & ~rpud3TextMenu) == (original & ~rpud3TextMenu));
            IO1[rwRegPwrUpDefaults3] = 0x55; bootLoad();
            assert(IO1[rwRegPwrUpDefaults3] == selected);
        }
        assert(IO1[rwRegPwrUpDefaults3] == original);
    }
    std::puts("512 production preference writes and reboot checks passed");
}
`);
        const output = path.join(temporary, 'preference.exe');
        const env = { ...process.env, PATH: path.dirname(compiler) + path.delimiter + process.env.PATH };
        const built = spawnSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror',
            '-I', path.join(__dirname, '../MinimalBoot/Common'), fixture, '-o', output], { encoding: 'utf8', env });
        assert.ifError(built.error);
        assert.equal(built.status, 0, built.stdout + built.stderr);
        const run = spawnSync(output, [], { encoding: 'utf8', env });
        assert.ifError(run.error);
        assert.equal(run.status, 0, run.stdout + run.stderr);
        assert.match(run.stdout, /512 production preference writes and reboot checks passed/);
        t.diagnostic(run.stdout.trim());
    } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
