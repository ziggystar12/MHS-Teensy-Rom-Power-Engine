'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const menuDir = path.resolve(__dirname, '..');
const settingsDir = path.join(menuDir, '../SettingsMenu');
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const first = probe.indexOf('class Cpu6502 {');
const last = probe.indexOf("test('assembled renderer", first);
const Cpu6502 = vm.runInNewContext(probe.slice(first, last) + '\nCpu6502;', { assert });

test('the packaged Settings program offers a fitting GUI/Text preference and executes the real toggle', async t => {
    const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
    const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];
    assert.ok(fs.existsSync(acme), 'ACME required; set ACME_EXE');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-preference-'));
    try {
        const binary = path.join(temporary, 'SettingsMenu.prg'), labels = path.join(temporary, 'symbols');
        const built = spawnSync(acme, ['--format', 'cbm', '--symbollist', labels,
            '--outfile', binary, 'source/SettingsMenu.asm'],
        { cwd: settingsDir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(built.error);
        assert.equal(built.status, 0, built.stdout + built.stderr);
        const s = Object.fromEntries([...fs.readFileSync(labels, 'utf8').matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
            .map(match => [match[1], parseInt(match[2], 16)]));
        const program = fs.readFileSync(binary);
        assert.equal(program.readUInt16LE(0), 0x0801);
        const fresh = () => {
            const memory = Buffer.alloc(65536);
            program.subarray(2).copy(memory, program.readUInt16LE(0));
            return new Cpu6502(memory);
        };
        const stub = (cpu, name, hook = () => {}) => {
            assert.ok(Number.isInteger(s[name]), name);
            cpu.m[s[name]] = 0x60;
            cpu.hooks.set(s[name], hook);
        };
        const petscii = text => [...text].map(character => {
            const value = character.charCodeAt(0);
            return value >= 65 && value <= 90 ? value + 128 : value >= 97 && value <= 122 ? value - 32 : value;
        });
        const terminal = cpu => {
            const screen = Array.from({ length: 25 }, () => Array(40).fill(32));
            let row = 0, column = 0;
            stub(cpu, 'SetCursor', current => {
                if (current.p & 1) { current.x = row; current.y = column; }
                else { row = current.x; column = current.y; }
            });
            stub(cpu, 'SendChar', current => {
                if (current.a === 13) { row++; column = 0; return; }
                if (current.a === 18 || current.a === 146) return;
                assert.ok(row < 25 && column < 40, `screen overflow at ${row},${column}`);
                screen[row][column++] = current.a;
                if (column === 40) { column = 0; row++; }
            });
            return { screen, position: (y, x) => { row = y; column = x; } };
        };
        await t.test('Settings header is the exact current assembled source used by MainMenuItems', () => {
            const header = fs.readFileSync(path.join(menuDir, '../../Teensy/TRMenuFiles/ROMs/SettingsMenu.prg.h'), 'utf8');
            assert.match(header, /PROGMEM\s+static const unsigned char SettingsMenu_prg\[\]/);
            const body = header.slice(header.indexOf('{'), header.indexOf('};'));
            const packaged = Buffer.from([...body.matchAll(/0x([0-9a-f]{2})/gi)].map(match => parseInt(match[1], 16)));
            assert.deepEqual(packaged, program, 'firmware must not carry the old Settings PRG');
            const items = fs.readFileSync(path.join(menuDir, '../../Teensy/MainMenuItems.h'), 'utf8');
            assert.match(items, /#include "TRMenuFiles\/ROMs\/SettingsMenu\.prg\.h"/);
            assert.match(items, /SettingsMenu_prg\s*,\s*sizeof\(SettingsMenu_prg\)/);
        });
        await t.test('the real text renderer keeps both mode labels above the footer without wrapping', () => {
            const cpu = fresh();
            const { screen, position } = terminal(cpu);
            position(2, 0);
            cpu.a = s.MsgStartupOptionsMenu & 255; cpu.y = s.MsgStartupOptionsMenu >> 8;
            cpu.call(s.PrintString);
            assert.deepEqual(screen[20].slice(8, 23), petscii('User interface:'));
            const before = screen.map(row => row.slice());
            for (const value of [1, 0, 129, 128]) {
                cpu.m[s.IO1Port + s.rwRegPwrUpDefaults3] = value;
                cpu.call(s.ShowStartupInterface);
                assert.deepEqual(screen[20].slice(23, 38), petscii(value & 1 ? 'Text / Original' : 'GUI            '));
                assert.deepEqual(screen.slice(21), before.slice(21), 'navigation footer is untouched');
                for (let y = 0; y < 25; y++) for (let x = 0; x < 40; x++)
                    if (y !== 20 || x < 23 || x >= 38) assert.equal(screen[y][x], before[y][x]);
            }
        });
        await t.test('E toggles only bit0 then waits for persistence before redrawing, for every prior byte', () => {
            for (let original = 0; original < 256; original++) {
                const cpu = fresh(), events = [];
                const register = s.IO1Port + s.rwRegPwrUpDefaults3;
                cpu.m[register] = original;
                stub(cpu, 'DisplayTime');
                stub(cpu, 'GetIn', current => { current.a = current.nz(petscii('e')[0]); });
                stub(cpu, 'WaitForTRWaitMsg', () => events.push('wait'));
                stub(cpu, 'ShowStartupOptionsSettings', () => events.push('redraw'));
                stub(cpu, 'CheckCommonKeys', () => assert.fail('E must be handled by the preference toggle'));
                cpu.onWrite = (address, value) => {
                    if (address >= s.IO1Port && address < s.IO1Port + 256) {
                        assert.equal(address, register, 'does not change other menu registers');
                        events.push(value);
                    }
                };
                cpu.call(s.WaitStartupOptionsMenuKey, 1000);
                assert.equal(cpu.m[register], original ^ 1);
                assert.deepEqual(events, [original ^ 1, 'wait', 'redraw']);
            }
        });
        t.diagnostic(`Settings program: ${program.length} bytes; row20 uses columns2..37; 256 actual key routes passed`);
    } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
