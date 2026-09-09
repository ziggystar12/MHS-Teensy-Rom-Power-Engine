'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

// Reuse the instruction-level probe without running the renderer's test suite.
// No calculator algorithm is reimplemented: every operation executes ACME bytes.
const probe = fs.readFileSync(path.join(__dirname, 'geos-color-publication.test.js'), 'utf8');
const probeStart = probe.indexOf('class Cpu6502 {');
const probeEnd = probe.indexOf("test('assembled renderer", probeStart);
assert.ok(probeStart >= 0 && probeEnd > probeStart, 'shared 6502 probe exists');
const Cpu6502 = vm.runInNewContext(probe.slice(probeStart, probeEnd) + '\nCpu6502;', { assert });
const menuDir = path.resolve(__dirname, '..');
const preview = fs.readFileSync(path.join(menuDir, 'preview-desktop.ps1'), 'utf8');
const acme = process.env.ACME_EXE || preview.match(/\$AcmePath\s*=\s*'([^']+)'/)[1];

test('native calculator: assembled arithmetic, errors, drawing, and hit boxes', async t => {
    if (!fs.existsSync(acme)) return t.skip('ACME unavailable; set ACME_EXE');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teensyrom-calculator-'));
    try {
        const harness = path.join(temporary, 'calculator.asm');
        const binary = path.join(temporary, 'calculator.bin');
        const symbolFile = path.join(temporary, 'symbols');
        const sourcePath = path.join(menuDir, 'source', 'GeosAppCalculator.s').replaceAll('\\', '/');
        fs.writeFileSync(harness, `!convtab pet
AppPosition=$0200
RichText=$0201
RichChar=$0202
RichRect=$0203
AppPrintNumber=$0204
UiButton=$0205
AppDirty=$0210
AppExit=$0211
AppNumber=$0212
RichX=$0214
RichXHi=$0215
RichY=$0216
RichW=$0217
RichWHi=$0218
RichH=$0219
RichInk=$021a
*=$c000
!src "${sourcePath}"
`);
        const result = spawnSync(acme, ['--format', 'plain', '--symbollist', symbolFile,
            '--outfile', binary, harness], { encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const symbols = Object.fromEntries([...fs.readFileSync(symbolFile, 'utf8')
            .matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
            .map(match => [match[1], parseInt(match[2], 16)]));
        const image = fs.readFileSync(binary);
        assert.ok(image.length <= 1100, `calculator size: ${image.length} <= 1100 bytes`);
        t.diagnostic(`Calculator image: ${image.length} bytes including all data`);
        const fresh = () => {
            const memory = Buffer.alloc(65536);
            image.copy(memory, 0xc000);
            memory.fill(0x60, 0x0200, 0x0206);
            const cpu = new Cpu6502(memory);
            cpu.call(symbols.CalcInit);
            return cpu;
        };
        const key = (cpu, value) => {
            cpu.a = typeof value === 'number' ? value : value.charCodeAt(0);
            cpu.call(symbols.CalcKey);
        };
        const enter = (cpu, text) => { for (const character of text) key(cpu, character); };
        const value = cpu => cpu.m.readInt16LE(symbols.CalcValue);
        const error = cpu => cpu.m[symbols.CalcError];

        await t.test('keyboard arithmetic, chaining, clear, negative results, integer division', () => {
            for (const [sequence, expected] of [
                ['12+34=', 46], ['100-123=', -23], ['0-123*4=', -492],
                ['7/2=', 3], ['0-7/2=', -3], ['0-7/2*2=', -6],
                ['32767-32767=', 0], ['32767*1=', 32767], ['0-32767-1=', -32768],
                ['0-32767-1/1=', -32768], ['0-32767-1*1=', -32768],
                ['13*0=', 0], ['0*32767=', 0], ['32767/1=', 32767],
                ['1/32767=', 0], ['16+4*3=', 60], ['12+=', 12],
                ['12+*3=', 36], ['12+3=4', 4], ['12+3=C9', 9],
            ]) {
                const cpu = fresh();
                enter(cpu, sequence);
                assert.equal(error(cpu), 0, `${sequence}: no error`);
                assert.equal(value(cpu), expected, sequence);
            }
            const cpu = fresh();
            enter(cpu, '5+8');
            key(cpu, 13);
            assert.equal(value(cpu), 13, 'RETURN evaluates');
        });

        await t.test('all arithmetic overflow and divide-by-zero paths are visible and recoverable', () => {
            for (const sequence of [
                '32768', '99999', '32767+1=', '0-32767-2=',
                '32767*2=', '256*256=', '30000*30000=', '1/0=', '0/0=',
                '0-32767-1/0=', '0-32767-1*2=',
            ]) {
                const cpu = fresh();
                enter(cpu, sequence);
                assert.equal(error(cpu), 1, sequence);
                assert.equal(cpu.m[symbols.AppDirty], 1, 'error requests redraw');
                key(cpu, 'C');
                assert.equal(error(cpu), 0);
                assert.equal(value(cpu), 0);
                enter(cpu, '8/0=');
                key(cpu, '9');
                assert.equal(error(cpu), 0, 'digit recovers from error');
                assert.equal(value(cpu), 9);
            }
        });

        await t.test('signed arithmetic fuzz cases execute actual machine code', () => {
            let randomState = 0x1541;
            const random16 = () => {
                randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
                return (randomState >>> 16) - 32768;
            };
            const operands = [[-32768, -1], [-32768, 1], [-32768, -32768],
                [32767, 32767], [-1, -1], [0, 0], [0, -32768], [32767, -32768]];
            for (let index = 0; index < 200; index++) operands.push([random16(), random16()]);
            for (const [left, right] of operands) for (const operator of '+-*/') {
                const cpu = fresh();
                cpu.m.writeInt16LE(left, symbols.CalcLeft);
                cpu.m.writeInt16LE(right, symbols.CalcValue);
                cpu.m[symbols.CalcOperator] = operator.charCodeAt(0);
                cpu.call(symbols.CalcCompute);
                const expected = operator === '+' ? left + right : operator === '-' ? left - right
                    : operator === '*' ? left * right : Math.trunc(left / right);
                const overflow = !Number.isFinite(expected) || expected < -32768 || expected > 32767;
                assert.equal(error(cpu), +overflow, `${left}${operator}${right}: error flag`);
                if (!overflow) assert.equal(value(cpu), expected || 0, `${left}${operator}${right}`);
            }
        });

        await t.test('all clickable button cells and gutters map to their drawn keys', () => {
            const keys = '789/456*123-C0=+';
            for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
                for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 6; dx++) {
                    const cpu = fresh();
                    let actual;
                    cpu.hooks.set(symbols.CalcKey, current => { actual = current.a; });
                    cpu.x = 5 + column * 7 + dx;
                    cpu.y = 9 + row * 3 + dy;
                    cpu.call(symbols.CalcClick);
                    assert.equal(actual, keys.charCodeAt(row * 4 + column), `button ${row},${column}`);
                }
            }
            for (let y = 0; y < 25; y++) for (let x = 0; x < 40; x++) {
                const inButton = y >= 9 && y < 21 && x >= 5 && x < 32 && (x - 5) % 7 < 6;
                if (inButton) continue;
                const cpu = fresh();
                let triggered = false;
                cpu.hooks.set(symbols.CalcKey, () => { triggered = true; });
                cpu.x = x;
                cpu.y = y;
                cpu.call(symbols.CalcClick);
                assert.equal(triggered, false, `outside button at ${x},${y}`);
            }
        });

        await t.test('draw uses matching rectangles, labels, and signed number display', () => {
            const cpu = fresh();
            const rectangles = [];
            const characters = [];
            const strings = [];
            let number;
            cpu.hooks.set(symbols.AppPosition, current => {
                current.m[symbols.RichX] = current.x;
                current.m[symbols.RichXHi] = 0;
                current.m[symbols.RichY] = current.y;
                current.m[symbols.RichInk] = 255;
            });
            cpu.hooks.set(symbols.UiButton, current => {
                rectangles.push([current.m[symbols.RichX], current.m[symbols.RichY],
                    current.m[symbols.RichW], current.m[symbols.RichH], current.a]);
                current.m[symbols.RichInk] = 255;
            });
            cpu.hooks.set(symbols.RichChar, current => { characters.push(current.a); });
            cpu.hooks.set(symbols.RichText, current => {
                let address = current.a | current.y << 8;
                let text = '';
                while (current.m[address]) text += String.fromCharCode(current.m[address++] & 0x7f);
                strings.push(text);
            });
            cpu.hooks.set(symbols.AppPrintNumber, current => { number = current.m.readUInt16LE(symbols.AppNumber); });
            cpu.m.writeInt16LE(-32768, symbols.CalcValue);
            cpu.call(symbols.CalcDraw);
            assert.equal(number, 32768, 'display takes magnitude without changing stored signed value');
            assert.equal(value(cpu), -32768);
            assert.equal(characters.shift(), 45, 'negative sign is drawn');
            assert.deepEqual(characters, [...'789/456*123-C0=+'].map(character => character.charCodeAt(0)));
            for (let index = 0; index < 16; index++) {
                const x = 40 + (index % 4) * 56;
                const y = 72 + Math.floor(index / 4) * 24;
                assert.deepEqual(rectangles[index], [x, y, 48, 24, 0], "normal shared button uses the click geometry");
            }
            assert.ok(strings.includes('INTEGER'));
            cpu.m[symbols.CalcError] = 1;
            cpu.call(symbols.CalcDraw);
            assert.ok(strings.includes('ERROR'), 'visible error message');
        });
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
