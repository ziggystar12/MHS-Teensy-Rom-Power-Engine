'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopMachine } = require('./desktop-machine');
const { backendPETSCII } = require('./backend-petscii');

test('native text decodes each real source encoding before selecting ASCII glyphs', t => desktopMachine(t,
    async ({ s, fresh, stub, textAt }) => {
        function serial(cpu, streams) {
            let selected = 0, offset = 0;
            const step = cpu.step.bind(cpu);
            cpu.step = () => {
                const address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
                if (cpu.m[cpu.pc] === 0xad && address === s.IO1Port + s.rwRegSerialString)
                    cpu.m[address] = (streams[selected] || [])[offset++] || 0;
                step();
            };
            cpu.onWrite = (address, value) => {
                if (address === s.IO1Port + s.rwRegSerialString) { selected = value; offset = 0; }
            };
            return { reads: () => offset };
        }
        await t.test('ACME PETSCII menu initials and backend paths retain their intended case', () => {
            for (const [menu, label, title] of [[s.rmtSD, 'MsgMenuSD', 'SD Card'],
                [s.rmtUSBDrive, 'MsgMenuUSBDrive', 'USB Drive'], [s.rmtTeensy, 'MsgMenuTeensy', 'Teensy Mem']]) {
                const cpu = fresh(), path = '/Games/Text_V1.0.6{Copy}|~';
                assert.ok(cpu.m[s[label]] >= 0xc1, 'local ACME uppercase is high PETSCII');
                cpu.m[s.IO1Port + s.rWRegCurrMenuWAIT] = menu;
                serial(cpu, { [s.rsstShortDirPath]: backendPETSCII(path) });
                stub(cpu, 'GeosBrowserReadState');
                cpu.call(s.GeosBrowserCaptureHeader);
                assert.equal(textAt(cpu, s.GeosBrowserTitle), title);
                assert.equal(textAt(cpu, s.GeosBrowserPath), path);
            }
        });
        await t.test('actual Delete dialog uses raw local titles/names and decoded backend status', () => {
            const cpu = fresh(), glyphs = [], name = 'Text_V1.0.6{Copy}|~.txt', prompt = 'Delete this file permanently?';
            cpu.p &= ~4;
            cpu.m[s.GeosFileLastState] = s.rfosDeleteReady;
            serial(cpu, { [s.rsstFileOpName]: Buffer.from(name), [s.rsstFileOpMessage]: backendPETSCII(prompt) });
            cpu.hooks.set(s.RichChar, c => glyphs.push({ code: c.a, x: c.m[s.RichX] + c.m[s.RichXHi] * 256, y: c.m[s.RichY] }));
            cpu.call(s.GeosFileDraw);
            const line = y => Buffer.from(glyphs.filter(g => g.y === y).map(g => g.code)).toString('latin1');
            assert.equal(line(46), 'File operation');
            assert.equal(line(60), name);
            assert.equal(line(122), prompt);
            assert.equal(line(144), 'CancelDelete');
            assert.equal(cpu.p & 4, 0, 'drawing retains enabled interrupts');
            assert.equal(cpu.m[1], 0x37, 'drawing restores the bank');
            // Verify actual published pixels, not just bytes passed to RichChar.
            for (const g of glyphs) for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
                const offset = ((g.y + row) >> 3) * 320 + ((g.x + col) >> 3) * 8 + ((g.y + row) & 7);
                const pixel = +(!!(cpu.m[s.GeosBitmapRAM + offset] & (128 >> ((g.x + col) & 7))));
                const expected = +(!!(cpu.m[s.GeosRichFont + (g.code - 32) * 8 + row] & (128 >> col)));
                // The default Cancel button has white glyphs on black.
                const inverse = g.y === 144 && g.x < 174;
                assert.equal(pixel, inverse ? 1 - expected : expected, `glyph ${String.fromCharCode(g.code)} at ${g.x},${g.y} pixel ${col},${row}`);
            }
        });
        await t.test('music title decodes the actual SID wire, bounds its caption and drains trailing metadata', () => {
            for (const name of ['Death_Is No Evil', 'The Last Ninja {SID} #1 | Mix~', 'Long_SID Name '.repeat(5)]) {
                const cpu = fresh(), wire = backendPETSCII('\r ' + name + '\rComposer and release metadata\r');
                cpu.p &= ~4;
                const bus = serial(cpu, { [s.rsstSIDInfo]: wire });
                const afterName = cpu.m[s.GeosMusicName + 39];
                cpu.call(s.GeosMusicReadName);
                assert.equal(textAt(cpu, s.GeosMusicName), name.slice(0, 38));
                assert.equal(bus.reads(), wire.length + 1, 'metadata and terminal NUL are consumed');
                assert.equal(cpu.m[s.GeosMusicName + 39], afterName, 'capture does not write past 38 characters plus NUL');
                assert.equal(cpu.p & 4, 0, 'music-title capture keeps IRQ enabled');
                const glyphs = [];
                cpu.hooks.set(s.RichChar, c => { if (c.m[s.RichY] === 124) glyphs.push(c.a); });
                cpu.call(s.GeosMusicCaption);
                assert.equal(Buffer.from(glyphs).toString('latin1'), name.slice(0, 38), 'actual caption selects correctly cased glyphs');
            }
        });
        await t.test('all printable backend message characters decode without changing raw ASCII local notices', () => {
            const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
            for (const wire of [false, true]) {
                const cpu = fresh(), glyphs = [];
                cpu.m[s.GeosDialogTextMode] = 1;
                cpu.m[s.GeosDialogColumn] = 43; cpu.m[s.GeosDialogLines] = 6;
                stub(cpu, 'RichChar', c => glyphs.push(c.a));
                if (wire) {
                    serial(cpu, { [s.rsstSerialStringBuf]: backendPETSCII(printable) });
                    cpu.a = s.rsstSerialStringBuf; cpu.call(s.GeosDialogSerial);
                } else {
                    Buffer.from(printable + '\0').copy(cpu.m, 0x18f0);
                    cpu.a = 0xf0; cpu.y = 0x18; cpu.call(s.GeosDialogLocal);
                }
                assert.equal(Buffer.from(glyphs).toString('latin1'), wire ? printable.replace('\\', '/').replace('`', "'") : printable);
            }
        });
        await t.test('lowercase p has the same x-height as o and a visible descender, distinct from uppercase P', () => {
            const cpu = fresh();
            const glyph = character => [...cpu.m.subarray(s.GeosRichFont + (character.charCodeAt(0) - 32) * 8,
                s.GeosRichFont + (character.charCodeAt(0) - 31) * 8)];
            const p = glyph('p');
            assert.equal(p.findIndex(row => row !== 0), glyph('o').findIndex(row => row !== 0));
            assert.deepEqual(p.slice(0, 2), [0, 0], 'bowl starts at lowercase x-height');
            assert.ok(p[5] && p[5] === p[6], 'stem continues for two pixels beneath the bowl');
            assert.notDeepEqual(p, glyph('P'));
        });
    }));
